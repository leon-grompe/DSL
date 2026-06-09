import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsParameter, SdsExpression } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { Activity, ValidationContext } from './model.js';
import { behaviourProtocol } from './behaviourProtocol.js';
import { ConsistentTransformationObserver, ProtocolObserver } from './protocolObserver.js';
import { ValidationResult } from './validationDataStructures.js';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // skip this validation if the pipeline is empty to avoid confusion with other validations
        if (node.body.statements.length < 1){ return; }

        // pre-define observers to be used in the protocol
        const observers: ProtocolObserver[] = [
            new ConsistentTransformationObserver(
                ['DataProcessing', 'FeatureEngineering'],
                ['DataProcessingQExploration'],
            ),
        ];

        // create validation context
        const { context, calls } = extractValidationContext(node, services, observers);

        // validate protocol
        const result = behaviourProtocol.validate(context, 0, services);

        // the pipeline does not follow the protocol
        if (!result.isValid){
            return generateProtocolValidation(node, calls, result, accept);
        }

        // the pipeline follows the protocol, but there might be issues reported to the observers
        generateObserverValidation(observers, accept);
        return;
    };
};

function generateObserverValidation(
    observers: ProtocolObserver[],
    accept: ValidationAcceptor
) : void {
    for (const observer of observers) {
        for (const { error, call } of observer.finalize()) {
            const msg = error.formatMessage('');
            if (msg) {
                accept(error.severity,
                    msg, {
                        node: call,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL
                    }
                );
            }
        }
    }
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

    // pipeline violates protocol at specific call
    if (call) {
        accept(valMessage.severity,
            valMessage.message, {
            node: call,
            code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL
        });
    }

    // pipeline violates protocol at end of the sequence by being incomplete
    else {
        accept(valMessage.severity,
            'Pipeline is missing at least one phase after this statement.\n' + valMessage.message, {
            node: calls.at(calls.length - 1) ?? node,
            code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
        });
    }
}

function extractValidationContext(
    node: SdsPipeline,
    services: SafeDsServices,
    observers: ProtocolObserver[],
): { context: ValidationContext; calls: SdsCall[] } {
    const analyzer = services.flow.DataFlowAnalyzer;
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    const pipelineCalls: SdsCall[] = [];
    const activitySequence: Activity[][] = [];
    const paramArgMaps: Map<SdsParameter, SdsExpression>[] = [];
    const pipelineStatements = node.body.statements;
    
    for (const statement of pipelineStatements) {
        // expand calls in statement to get nested calls and their parameter-argument mappings
        const statementCallsWithParamArgMap = analyzer.expandCallsInStatement(statement);

        for (const { call, paramArgMap } of statementCallsWithParamArgMap) {
            const callable = nodeMapper.callToCallable(call);
            if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

            // get all annotations (DSPipelineActivities) of the callable
            const annotations = builtinAnnotations
                .streamDSPipelineActivities(callable as SdsAnnotatedObject)
                .map(variant => variant.name)
                .toArray();

            // if there are no annotations, consider it as an 'Any' activity that can fit anywhere in the protocol
            const activities = annotations.length > 0
                ? annotations.map(name => new Activity(name))
                : [new Activity('Any')];

            pipelineCalls.push(call);
            activitySequence.push(activities);
            paramArgMaps.push(paramArgMap);
        }
    }

    return {
        context: new ValidationContext(activitySequence, pipelineCalls, paramArgMaps, pipelineStatements, observers),
        calls: pipelineCalls,
    };
}
