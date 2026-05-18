import { ValidationAcceptor, ValidationSeverity } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsPlaceholder } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { ProtocolBlock, ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock, Activity, ValidationContext, DataSet } from './model.js';
import { ValidationResult, ValidationError} from './validationDataStructures.js'
import { behaviourProtocol } from './behaviourProtocol.js';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // skip this validation if the pipeline is empty to avoid confusion with other validations
        if (node.body.statements.length < 1){ return; }

        const calls = [] as SdsCall[];
        const sequence = [] as Activity[][];
        
        // fill the sequence of found calls in the pipeline
        for (const statement of node.body.statements){
            const statementCalls = nodeMapper.statementToCalls(statement);

            for (const call of statementCalls){
                calls.push(call);
                
                // for each call, find the corresponding annotations and add an array of them to the sequence
                // if no annotation is found, add an array with singular activity 'Any' instead
                const callable = nodeMapper.callToCallable(call);
                if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

                const annotations = builtinAnnotations
                    .streamDSPipelineActivities(callable as SdsAnnotatedObject)
                    .map(variant => variant.name)
                    .toArray();

                const activities = annotations.length > 0
                    ? annotations.map(name => new Activity(name))
                    : [new Activity('Any')];
                
                sequence.push(activities);
            }
        }
        const context = new ValidationContext(sequence, calls)

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
                    'Pipeline is missing at least one phase after this statement. ' + validationMessage, {
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
    
    // dataset error is most critical error, break if detected
    const datasetError = nestedErrors.find(e => e.type === 'dataset-mismatch');
    if (datasetError && datasetError.type === 'dataset-mismatch') {
        return [`Dataset mismatch: expected ${datasetError.expected} dataset but found ${datasetError.found} dataset.`,
                'error'];
    }

    let phase = '';
    for (const error of nestedErrors) {
        if (error.type === 'repetition-block-minimum-not-met' && error.phaseName) {
            phase = `'${error.phaseName}'`;
            break;
        }
    }

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

const sliceActivityName = (activityName: string): string => {
    const qIndex = activityName.indexOf('Q');
    return qIndex !== -1 ? activityName.slice(qIndex + 1) : activityName;
}
const slicePhaseName = (activityName: string): string => {
    const qIndex = activityName.indexOf('Q');
    return qIndex !== -1 ? activityName.slice(0, qIndex) : activityName;
}
const replaceQ = (activityName: string): string => {
    return activityName.replace('Q', ' - ');
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