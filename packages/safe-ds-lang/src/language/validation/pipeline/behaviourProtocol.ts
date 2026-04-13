import { ValidationAcceptor } from 'langium';
import { isSdsAnnotatedObject, isSdsAssignment, isSdsCall, isSdsExpressionStatement, isSdsFunction, isSdsMemberAccess, isSdsOutputStatement, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsStatement } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';


export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // Define phase order
        const phaseOrder = [
            'DataAcquisition', 'DataPreparation', 'DataPreprocessing', 
            'FeatureEngineering', 'FeatureSelection', 'Modeling', 'Training', 'Prediction', 'Evaluation', 'Testing',
            'Interpretation'
        ];
        let currentPhase = -1;

        const statements = node.body.statements;
        let annotatedObjects: SdsAnnotatedObject[] = [];
        
        for (const statement of statements) {            
            const call = getCallFromStatement(statement);
            if (!call) continue;

            const callable = nodeMapper.callToCallable(call);
            if (!callable || !(isSdsFunction(callable))) continue;

            const phase = builtinAnnotations.getDSPipelinePhase(callable);
            if (!phase) continue;
            console.log(`Found phase annotation '${phase.name}' on function '${callable.name}'`);
            
            const phaseIndex = phaseOrder.indexOf(phase.name);
            if (phaseIndex < 0) continue;
            console.log(`Phase '${phase.name}' has index ${phaseIndex} in the phase order`);
            console.log(`Current phase index is ${currentPhase}`);
            
            if (phaseIndex < currentPhase) {
                accept('warning',
                    `Function '${callable.name}' is annotated with phase '${phase.name}' but occurs after phase '${phaseOrder[currentPhase]}'.`,
                    {
                        node: call,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            } else {
                currentPhase = phaseIndex;
            };
        };
    };
};

const getCallFromStatement = (statement: SdsStatement): SdsCall | undefined => {
    if (isSdsExpressionStatement(statement) && isSdsCall(statement.expression)) {
        return statement.expression;
    }
    if (isSdsAssignment(statement) && statement.expression && isSdsCall(statement.expression)) {
        return statement.expression;
    }
    if (isSdsOutputStatement(statement) && isSdsCall(statement.expression)) {
        return statement.expression;
    }
    return undefined;
};