import { AstNode, ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsExpression } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { Activity, ValidationContext } from './protocol/model.js';
import { DSPipelineActivity } from './protocol/dsPipelineActivity.js';
import { DSPipelinePhase } from './protocol/dsPipelinePhase.js';
import { behaviourProtocol } from './behaviourProtocol.js';
import { ConsistentTransformationObserver, ProtocolObserver } from './protocol/observer.js';
import { DatasetMismatchError, InconsistentTransformationPresenceError, InconsistentTransformationOrderError, InconsistentTransformationDataflowError } from './protocol/errors.js';
import { ValidationResult } from './protocol/validationResult.js';

// protocol error codes
export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL   = 'pipeline/behaviour-protocol';
export const CODE_PIPELINE_INCOMPLETE           = 'pipeline/incomplete-sequence';
export const CODE_DATASET_MISMATCH              = 'pipeline/dataset-mismatch';

// observer error codes
export const CODE_PIPELINE_OBSERVER = 'pipeline/observer-error';
export const CODE_INCONSISTENT_TRANSFORMATION_PRESENCE  = 'pipeline/inconsistent-transformation-presence';
export const CODE_INCONSISTENT_TRANSFORMATION_ORDER     = 'pipeline/inconsistent-transformation-order';
export const CODE_INCONSISTENT_TRANSFORMATION_DATAFLOW  = 'pipeline/inconsistent-transformation-dataflow';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        if (!node.body) return;
        
        const pipelineCalls: SdsCall[] = [];
        // pre-define observers to be used in the protocol
        const observers: ProtocolObserver[] = [
            new ConsistentTransformationObserver(
                services,
                node.body.statements,
                [DSPipelinePhase.DataProcessing, DSPipelinePhase.FeatureEngineering, DSPipelinePhase.FeatureSelection],
                [
                    DSPipelineActivity.DataProcessingQExploration,
                    DSPipelineActivity.DataProcessingQPostSplitCleaning,
                    DSPipelineActivity.DataProcessingQAugmentation,
                    DSPipelineActivity.DataProcessingQUtilities,
                    DSPipelineActivity.FeatureEngineeringQUtilities,
                ],
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
    
    if (!node.body) return new ValidationContext(activitySequence, pipelineCalls, segmentCallSites, [], observers);
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

/**
 * Generates validation messages for a protocol violation found in the pipeline.
 * If the violation is a dataset mismatch, it will also generate a quickfix to swap the wrong dataset reference.
 * If the violation is found inside a segment, the message will be reported on the segment call site and will
 * include a suffix naming the offending inner call.
 */
const generateProtocolValidation = (
    node: SdsPipeline,
    context: ValidationContext,
    result: ValidationResult,
    accept: ValidationAcceptor,
    services: SafeDsServices,
) : void => {
    const locator = services.workspace.AstNodeLocator;
    const identifier = services.flow.DatasetIdentifier;
    const calls = context.calls;

    // get the problematic call
    const call = calls[result.validatedIndex];

    // if the call is inside a segment, this is the pipeline-level call site that invoked the segment.
    // it was recorded during call expansion, so we can just read it by index here.
    const segmentCallSite = context.segmentCallSites[result.validatedIndex];

    // get the validation message (aggregated from the entire protocol execution)
    const valMessage = result.generateValidationMessage();

    // a dataset mismatch is a priority error, so it already drives valMessage
    const datasetError = result.error instanceof DatasetMismatchError ? result.error : undefined;

    if (call) {
        if (datasetError) {
            // the wrong dataset is always swapped at the pipeline level: directly on the offending call,
            // or — for a segment — on the argument that fed the wrong partition into the segment call site
            // (the segment body itself is generic and must not be touched)
            const wrongReference = segmentCallSite
                ? identifier.findDatasetReferenceInCall(segmentCallSite, context.statements, datasetError.found)
                : datasetError.wrongReference;

            const message = segmentCallSite ? valMessage.message + segmentCauseSuffix(call, services) : valMessage.message;

            if (wrongReference) {
                // report on the wrong dataset reference itself and offer a quickfix to swap it
                accept(valMessage.severity, message, {
                    node: wrongReference,
                    code: CODE_DATASET_MISMATCH,
                    data: { path: locator.getAstNodePath(wrongReference), expected: datasetError.expected },
                });
                generatePipelineValidation(node, wrongReference, accept);
            } else {
                // couldn't resolve a reference to swap: keep the diagnostic, but no quickfix
                accept(valMessage.severity, message, {
                    node: segmentCallSite ?? call,
                    code: CODE_DATASET_MISMATCH,
                });
                generatePipelineValidation(node, segmentCallSite ?? call, accept);
            }
        } else {
            // pipeline violates protocol at specific call. if that call is inside a segment, report on
            // the segment call site instead and name the offending inner call in the message
            accept(valMessage.severity,
                segmentCallSite ? valMessage.message + segmentCauseSuffix(call, services) : valMessage.message, {
                node: segmentCallSite ?? call,
                code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL
            });
            generatePipelineValidation(node, segmentCallSite ?? call, accept);
        }
    } else {
        // pipeline violates protocol at end of the sequence by being incomplete. mirror the
        // specific-call case: if the last call is inside a segment, report on its call site
        const lastCall = calls.at(calls.length - 1);
        const lastSegmentCallSite = context.segmentCallSites.at(calls.length - 1);
        if (!lastCall) {
            // pipeline is empty, so report on the pipeline itself
            accept(valMessage.severity, 
                valMessage.message, {
                node: node.body,
                code: CODE_PIPELINE_INCOMPLETE,
            });
            generatePipelineValidation(node, node.body, accept);

        } else {
            accept(valMessage.severity, 
                valMessage.message, {
                node: lastSegmentCallSite ?? lastCall,
                code: CODE_PIPELINE_INCOMPLETE,
            });
            generatePipelineValidation(node, lastSegmentCallSite ?? lastCall, accept);
        }
    }
}

/**
 * Generates validation messages for all errors reported by the observers.
 * Each observer can report multiple errors, and each error can be reported on a different call site.
 * The validation code is set depending on the concrete instance of the error.
 */
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
            
            const msg = error.formatMessage();
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

/**
 * Generates a validation message for the pipeline itself, indicating that it has been validated by the behaviour protocol until a certain point.
 * This message is informational and does not indicate an error, but rather provides feedback on the validation process.
 * The message includes a link to documentation for further reading on pipeline structure, best practices, and activities.
 */
const generatePipelineValidation = (
    pipeline: SdsPipeline,
    erroneousPoint: AstNode,
    accept: ValidationAcceptor
) => {
    const line = erroneousPoint.$cstNode?.range.start.line! + 1;
    accept('info', 
        `Pipeline has been validated by the behaviour protocol until line ${line}.\n` + 
        `Read more about pipeline structure, best practices and activities at: ...\n` + 
        `You may disable this validation entirely by adding '@DisableProtocol' before the pipeline declaration.`, {
        node: pipeline,
        property: 'name',
        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL
    });
}

/**
 * Builds a message suffix naming the offending inner call, used when a protocol violation found
 * inside a segment is reported on the segment call site so the original cause stays discoverable.
 */
const segmentCauseSuffix = (call: SdsCall, services: SafeDsServices): string => {
    const callable = services.helpers.NodeMapper.callToCallable(call);
    const name = (isSdsFunction(callable) || isSdsClass(callable)) ? callable.name : undefined;
    return name
        ? `\n(The problem originates from the call to '${name}' inside this segment — fix it there.)`
        : '\n(The problem originates from a call inside this segment.)';
}