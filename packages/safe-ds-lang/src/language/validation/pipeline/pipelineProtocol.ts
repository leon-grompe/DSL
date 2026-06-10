import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { Activity, ValidationContext } from './protocol/model.js';
import { DSPipelineActivity } from './protocol/dsPipelineActivity.js';
import { behaviourProtocol } from './behaviourProtocol.js';
import { ConsistentTransformationObserver, ProtocolObserver } from './protocol/observer.js';
import { ValidationResult, InconsistentTransformationError } from './protocol/errors.js';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';
export const CODE_PIPELINE_DATASET_MISMATCH = 'pipeline/dataset-mismatch';
export const CODE_PIPELINE_INCOMPLETE = 'pipeline/incomplete-sequence';
export const CODE_INCONSISTENT_TRANSFORMATION = 'pipeline/inconsistent-transformation';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // skip this validation if the pipeline is empty to avoid confusion with other validations
        if (node.body.statements.length < 1){ return; }
        
        const pipelineCalls: SdsCall[] = [];

        // pre-define observers to be used in the protocol
        const observers: ProtocolObserver[] = [
            new ConsistentTransformationObserver(
                services,
                ['DataProcessing', 'FeatureEngineering'],
                [DSPipelineActivity.DataProcessingQExploration],
            ),
        ];

        // create validation context
        const context = extractValidationContext(node, services, observers, pipelineCalls);

        // validate protocol
        const result = behaviourProtocol.validate(context, 0, services);
        
        // generate validation messages for protocol violations
        if (!result.isValid){
            generateProtocolValidation(node, pipelineCalls, result, accept);
        }
        generateObserverValidation(observers, accept);
    };
};

function extractValidationContext(
    node: SdsPipeline,
    services: SafeDsServices,
    observers: ProtocolObserver[],
    pipelineCalls: SdsCall[] = []
): ValidationContext {
    const analyzer = services.flow.DataFlowAnalyzer;
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    const activitySequence: Activity[][] = [];
    const segmentCallSites: (SdsCall | undefined)[] = [];
    const pipelineStatements = node.body.statements;

    for (const statement of pipelineStatements) {
        // expand calls in statement to get nested calls and their parameter-argument mappings
        const statementCallsWithParamArgMap = analyzer.expandCallsInStatement(statement);

        for (const { call, segmentCallSite } of statementCallsWithParamArgMap) {
            const callable = nodeMapper.callToCallable(call);
            if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

            // get all annotations (DSPipelineActivities) of the callable
            const annotations = builtinAnnotations
                .streamDSPipelineActivities(callable as SdsAnnotatedObject)
                .map(variant => variant.name)
                .toArray();

            // if there are no annotations, consider it as an 'Any' activity that can fit anywhere in the protocol
            const activities = annotations.length > 0
                ? annotations.map(name => name as Activity)
                : [DSPipelineActivity.Any];

            pipelineCalls.push(call);
            segmentCallSites.push(segmentCallSite);
            activitySequence.push(activities);
        }

    }

    return new ValidationContext(activitySequence, pipelineCalls, segmentCallSites, pipelineStatements, observers);
}

function generateProtocolValidation(
    node: SdsPipeline,
    calls: SdsCall[],
    result: ValidationResult,
    accept: ValidationAcceptor
) : void {
    // get the problematic call
    const call = calls[result.validatedIndex];

    // get the validation message (aggregated from the entire protocol execution)
    const valMessage = result.generateValidationMessage();

    if (call) {
        // pipeline violates protocol at specific call
        accept(valMessage.severity,
            valMessage.message, {
            node: call,
            code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL
        });
    } else {
        // pipeline violates protocol at end of the sequence by being incomplete
        accept(valMessage.severity,
            'Pipeline is missing at least one phase after this statement.\n' + valMessage.message, {
            node: calls.at(calls.length - 1) ?? node,
            code: CODE_PIPELINE_INCOMPLETE,
        });
    }
}

function generateObserverValidation(
    observers: ProtocolObserver[],
    accept: ValidationAcceptor
) : void {
    for (const observer of observers) {
        const observerErrors = observer.finalize();
        let validationCode = CODE_PIPELINE_BEHAVIOUR_PROTOCOL;
        
        if (observer instanceof ConsistentTransformationObserver && observerErrors.length > 0) {
            validationCode = CODE_INCONSISTENT_TRANSFORMATION;
        }
        
        for (const { error, call } of observerErrors) {
            
            if (error instanceof InconsistentTransformationError) {}

            const msg = error.formatMessage('');
            if (!msg) continue;
            
            accept(error.severity,
                msg, {
                    node: call,
                    code: validationCode
                }
            );
        }
    }
}