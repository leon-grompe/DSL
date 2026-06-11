import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { Activity, ValidationContext } from './protocol/model.js';
import { DSPipelineActivity } from './protocol/dsPipelineActivity.js';
import { behaviourProtocol } from './behaviourProtocol.js';
import { ConsistentTransformationObserver, ProtocolObserver } from './protocol/observer.js';
import { ValidationResult, InconsistentTransformationPresenceError, InconsistentTransformationOrderError, InconsistentTransformationDataflowError } from './protocol/errors.js';

// protocol error codes
export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';
export const CODE_PIPELINE_INCOMPLETE = 'pipeline/incomplete-sequence';

// observer error codes
export const CODE_PIPELINE_OBSERVER = 'pipeline/observer-error';
export const CODE_INCONSISTENT_TRANSFORMATION_PRESENCE = 'pipeline/inconsistent-transformation-presence';
export const CODE_INCONSISTENT_TRANSFORMATION_ORDER = 'pipeline/inconsistent-transformation-order';
export const CODE_INCONSISTENT_TRANSFORMATION_DATAFLOW = 'pipeline/inconsistent-transformation-dataflow';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // skip this validation if the pipeline is empty to avoid confusion with other validations
        if (node.body.statements.length < 1){ return; }
        
        const pipelineCalls: SdsCall[] = [];

        // pre-define observers to be used in the protocol
        const observers: ProtocolObserver[] = [
            new ConsistentTransformationObserver(
                services,
                node.body.statements,
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
            generateProtocolValidation(node, context, result, accept, services);
        }
        generateObserverValidation(observers, accept);
    };
};

const extractValidationContext = (
    node: SdsPipeline,
    services: SafeDsServices,
    observers: ProtocolObserver[],
    pipelineCalls: SdsCall[] = []
): ValidationContext => {
    const analyzer = services.flow.DataFlowAnalyzer;
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    const activitySequence: Activity[][] = [];
    const segmentCallSites: (SdsCall | undefined)[] = [];
    const pipelineStatements = node.body.statements;

    for (const statement of pipelineStatements) {
        // expand calls in statement to get nested calls and parameter-argument mappings for segments
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

const generateProtocolValidation = (
    node: SdsPipeline,
    context: ValidationContext,
    result: ValidationResult,
    accept: ValidationAcceptor,
    services: SafeDsServices,
) : void => {
    const calls = context.calls;

    // get the problematic call
    const call = calls[result.validatedIndex];

    // if the call is inside a segment, this is the pipeline-level call site that invoked the segment.
    // it was recorded during call expansion (the segment call itself is not part of 'calls'), so we
    // just read it by index here instead of trying to rediscover it from the call's AST container.
    const segmentCallSite = context.segmentCallSites[result.validatedIndex];

    // get the validation message (aggregated from the entire protocol execution)
    const valMessage = result.generateValidationMessage();

    if (call) {
        // pipeline violates protocol at specific call. if that call is inside a segment, report on
        // the segment call site instead and name the offending inner call in the message.
        accept(valMessage.severity,
            segmentCallSite ? valMessage.message + segmentCauseSuffix(call, services) : valMessage.message, {
            node: segmentCallSite ?? call,
            code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL
        });
    } else {
        // pipeline violates protocol at end of the sequence by being incomplete. mirror the
        // specific-call case: if the last call is inside a segment, report on its call site
        const lastCall = calls.at(calls.length - 1);
        const lastSegmentCallSite = context.segmentCallSites.at(calls.length - 1);

        accept(valMessage.severity,
            'Pipeline is missing at least one phase after this statement.\n' + valMessage.message, {
            node: lastSegmentCallSite ?? lastCall ?? node,
            code: CODE_PIPELINE_INCOMPLETE,
        });
    }
}

/**
 * Builds a message suffix naming the offending inner call, used when a protocol violation found
 * inside a segment is reported on the segment call site so the original cause stays discoverable.
 */
const segmentCauseSuffix = (call: SdsCall, services: SafeDsServices): string => {
    const callable = services.helpers.NodeMapper.callToCallable(call);
    const name = (isSdsFunction(callable) || isSdsClass(callable)) ? callable.name : undefined;
    return name
        ? `\n(Caused by the call to '${name}' inside this segment.)`
        : '\n(Caused by a call inside this segment.)';
}

const generateObserverValidation = (
    observers: ProtocolObserver[],
    accept: ValidationAcceptor
) : void => {
    for (const observer of observers) {
        const observerErrors = observer.finalize();
        // set general validation code
        let validationCode = CODE_PIPELINE_OBSERVER;
        
        for (const { error, call } of observerErrors) {
            // specify validation code depending on concrete instance of the error
            if (error instanceof InconsistentTransformationPresenceError) {
                validationCode = CODE_INCONSISTENT_TRANSFORMATION_PRESENCE;
            } else if (error instanceof InconsistentTransformationOrderError) {
                validationCode = CODE_INCONSISTENT_TRANSFORMATION_ORDER;
            } else if (error instanceof InconsistentTransformationDataflowError) {
                validationCode = CODE_INCONSISTENT_TRANSFORMATION_DATAFLOW;
            }
            
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