import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsParameter, SdsExpression } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { Activity, ValidationContext } from './model.js';
import { behaviourProtocol } from './behaviourProtocol.js';
import { ConsistentTransformationObserver } from './protocolObserver.js';

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
            const statementCalls = analyzer.expandCallsInStatement(statement);

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

        const observers = [
            new ConsistentTransformationObserver(
                ['DataProcessing', 'FeatureEngineering'],
                ['DataProcessingQExploration'],
            ),
        ];
        const context = new ValidationContext(sequence, calls, paramArgMaps, node.body.statements, observers);

        const result = behaviourProtocol.validate(context, 0, services);

        if (!result.isValid){
            const call = calls[result.validatedIndex];
            const { message, severity } = result.generateValidationMessage();

            if (call) {
                accept(severity, message, { node: call, code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL });
            } else {
                accept(severity,
                    'Pipeline is missing at least one phase after this statement.\n' + message, {
                        node: calls.at(calls.length - 1) ?? node,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            }
            return;
        }

        for (const observer of observers) {
            for (const { error, call } of observer.finalize()) {
                const msg = error.formatMessage('');
                if (msg) accept(error.severity, msg, { node: call, code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL });
            }
        }
    };
};