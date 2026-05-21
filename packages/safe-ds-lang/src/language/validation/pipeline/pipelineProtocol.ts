import { ValidationAcceptor, ValidationSeverity } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsParameter, SdsExpression } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { Activity, ValidationContext } from './model.js';
import { ValidationResult, ValidationError} from './validationDataStructures.js'
import { behaviourProtocol } from './behaviourProtocol.js';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;
    const analyzer = services.flow.DataFlowAnalyzer;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // skip this validation if the pipeline is empty to avoid confusion with other validations
        if (node.body.statements.length < 1){ return; }

        const calls = [] as SdsCall[];
        const sequence = [] as Activity[][];
        const paramArgMaps = [] as Map<SdsParameter, SdsExpression>[];

        for (const statement of node.body.statements) {
            const statementCalls = nodeMapper.statementToCalls(statement);

            for (const { call, paramArgMap } of statementCalls) {
                const callable = nodeMapper.callToCallable(call);
                if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

                const annotations = builtinAnnotations
                    .streamDSPipelineActivities(callable as SdsAnnotatedObject)
                    .map(variant => variant.name)
                    .toArray();

                const activities = annotations.length > 0
                    ? annotations.map(name => new Activity(name))
                    : [new Activity('Any')];

                calls.push(call);
                sequence.push(activities);
                paramArgMaps.push(paramArgMap);  // ← store alongside
            }
        }

        const context = new ValidationContext(sequence, calls, paramArgMaps);
        console.log('\n=== VALIDATION CONTEXT DEBUG ===');
        for (let i = 0; i < calls.length; i++) {
            const callText = calls[i]?.$cstNode?.text?.split('\n')[0];
            const activities = sequence[i]?.map(a => a.activityName).join(', ');
            //const fromSeg = context.fromSegment[i] ? ' [FROM SEGMENT]' : '';
            
            // dataset analysis
            const call = calls[i]!;
            const paramArgMap = paramArgMaps[i] ?? new Map();
            const isTrain = analyzer.callReferencesTrainingSet(call, paramArgMap);
            const isTest  = analyzer.callReferencesTestSet(call, paramArgMap);
            const isVal   = analyzer.callReferencesValidationSet(call, paramArgMap);
            const dataset = isTrain ? 'Training' : isTest ? 'Test' : isVal ? 'Validation' : 'Original';
            
            //console.log(`[${i}]${fromSeg}`);
            console.log(`     call:       ${callText}`);
            console.log(`     activities: ${activities}`);
            console.log(`     dataset:    ${dataset}`);
            console.log(`     paramArgMap: {${
                Array.from(paramArgMap.entries())
                    .map(([p, e]) => `${p.name} → ${e.$cstNode?.text}`)
                    .join(', ')
            }}`);
        }
        console.log('=== END CONTEXT DEBUG ===\n');

        const result = behaviourProtocol.validate(context, 0, services);
        
        if (!result.isValid){
            const call = calls[result.validatedIndex];
            const [validationMessage, severity] = computeValidationMessageAndSeverity(result);
            
            // mistake is inside the pipeline => validation message on wrong call
            if (call) {
                accept(severity,
                    validationMessage, {
                        node: call,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            }
            // something is missing at the end of the pipeline => validation message on the end of the pipeline
            else {
                accept(severity,
                    'Pipeline is missing at least one phase after this statement.\n' + validationMessage, {
                        node: calls.at(calls.length-1) ?? node,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            }
            return;
        };
    };
};

const computeValidationMessageAndSeverity = (result: ValidationResult): [string, ValidationSeverity] => {
    const nestedErrors = extractNestedValidationErrors(result);
    
    // get the current phase to use in validation messages, if applicable
    let phase = '';
    for (const error of nestedErrors) {
        if (error.type === 'repetition-block-minimum-not-met' && error.phaseName) {
            phase = `'${error.phaseName}'`;
            break;
        }
    }

    // dataset error is most critical error, break if detected
    const datasetError = nestedErrors.find(e => e.type === 'dataset-mismatch');
    if (datasetError && datasetError.type === 'dataset-mismatch') {
        const formattedActivites = getActivityOnPhaseMatch(datasetError.activities ?? [], phase).map(name => `${name}`).join(', ');
        
        return [`Dataset mismatch: During phase ${phase} the activity '${formattedActivites}' may only be `+ 
                `performed on the '${datasetError.expected}' dataset, not the '${datasetError.found}' dataset.`,
                'error'];
    }
    
    // then get all other errors and concatenate corresponding messages
    const messages: string[] = []; 
    for (const error of nestedErrors) {
        switch (error.type) {
            case 'sequence-block-failed': {
                break; // no relevant information
            }
            case 'repetition-block-minimum-not-met': {
                if (error.min > 1 && error.actual > 1) {
                    messages.push(`Phase ${phase} requires at least ${error.min} occurrences but found ${error.actual}.`);
                } else {
                    messages.push(`Detected activity is not allowed during phase ${phase}.`);
                }
                break;
            }
            case 'or-block-no-match': {
                const subMessage = phase !== '' ? `phase ${phase}` : 'current phase';
                const names = error.alternatives
                    .map(a => `'${sliceActivityName(a.activityName)}'`)
                    .join(', ');
                messages.push(`Expected one of the following activities during ${subMessage}: ${names}.`);
                break;
            }
            case 'elem-block-activity-mismatch': {
                const foundNames = error.found
                    .map(a => `'${sliceActivityName(a.activityName)}'`)
                    .join(', ');
                messages.push( `Expected '${replaceQ(error.expected.activityName)}' ` + 
                               `but found ${[...new Set(error.found.map(a => `'${replaceQ(a.activityName)}'`))].join(', ')}.`);
                break;
            }
            case 'elem-block-oob': {
                messages.push('Pipeline ended unexpectedly.');
                break;
            }
            case 'alternative-block-no-match': {
                break;
            }
            case 'xor-block-multiple-matches': {
                break; // not relevant in behaviour protocol
            }
        }
    }

    return [messages.join('\n'), 'warning'];
}

const extractNestedValidationErrors = (result: ValidationResult): ValidationError[] => {
    const errors = [] as ValidationError[];
    let current: ValidationResult | undefined = result;
    while (current) {
        if (current.error) {
            errors.push(current.error);
        }
        current = current.baseError;
    }
    return errors;
}

// string manipulation helpers for better validation messages
const sliceActivityName = (activityName: string | undefined): string => {
    if (!activityName) return '';
    const qIndex = activityName.indexOf('Q');
    return qIndex !== -1 ? activityName.slice(qIndex + 1) : activityName;
}
const slicePhaseName = (activityName: string | undefined): string => {
    if (!activityName) return '';
    const qIndex = activityName.indexOf('Q');
    return qIndex !== -1 ? activityName.slice(0, qIndex) : activityName;
}
const replaceQ = (activityName: string | undefined): string => {
    if (!activityName) return '';
    return activityName.replace('Q', ' - ');
}
const getActivityOnPhaseMatch = (activities: Activity[], phaseName: string): string[] => {
    const cleanPhaseName = phaseName.replaceAll("'", '').trim();
    
    return activities.map(a => a.activityName)
        .filter(name => name.split('Q')[0] === cleanPhaseName)
        .map(item => item.split('Q')[1])
        .filter((item): item is string => item !== undefined);
}