import { ValidationAcceptor } from 'langium';
import { isSdsCall, isSdsFunction, SdsPipeline } from '../../generated/ast.js';
import { } from '../../helpers/nodeProperties.js';
import { SafeDsServices } from '../../index.js';

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
        let currentPhaseIndex = -1;

        // Traverse pipeline statements
        for (const statement of node.body?.statements ?? []) {
            if (isSdsCall(statement)) {
                const callable = nodeMapper.callToCallable(statement);
                if (callable && isSdsFunction(callable)) {
                    const phase = builtinAnnotations.getDSPipelinePhase(callable);
                    if (phase) {
                        const phaseIndex = phaseOrder.indexOf(phase.name);
                        if (phaseIndex < currentPhaseIndex) {
                            accept('error', `Function '${callable.name}' with phase '${phase.name}' cannot be used after a later phase.`, {
                                node: statement,
                                code: 'pipeline/behaviour-protocol',
                            });
                        } else {
                            currentPhaseIndex = Math.max(currentPhaseIndex, phaseIndex);
                        }
                    }
                }
            }
        }
    };
};
