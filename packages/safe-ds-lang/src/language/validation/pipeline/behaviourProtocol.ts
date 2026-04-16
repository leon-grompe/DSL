import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsPipeline, SdsStatement } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { ProtocolBlock, ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock, Phase } from './model.js';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

/*
export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        const phaseOrder = [
            'DataAcquisition', 'DataPreparation', 'DataPreprocessing', 
            'FeatureEngineering', 'FeatureSelection', 'Modeling', 'Training', 'Prediction', 'Evaluation', 'Testing',
            'Interpretation'
        ];
        let currentPhase = -1;
        const statements = node.body.statements;
        
        for (const statement of statements) {            
            const call = nodeMapper.statementToCall(statement);
            if (!call) continue;

            const callable = nodeMapper.callToCallable(call);
            if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

            const phase = builtinAnnotations.getDSPipelinePhase(callable as SdsAnnotatedObject);
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
*/

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // fill the sequence of phases based on the annotations in the pipeline
        // if an function has no phase annotation, it is assigned the phase any
        const sequence = [] as Phase[];
        const calls = [] as SdsStatement[];
        for (const statement of node.body.statements) {
            const call = nodeMapper.statementToCall(statement);
            if (!call) continue;
            calls.push(statement);

            const callable = nodeMapper.callToCallable(call);
            if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

            const annotation = builtinAnnotations.getDSPipelinePhase(callable as SdsAnnotatedObject);
            if (!annotation) {
                sequence.push(new Phase('Any'));
                continue;
            };            
            sequence.push(new Phase(annotation.name));
        }
        console.log('Sequence of phases in the pipeline:', sequence.map(phase => phase.name).join(', '));

        const [isValid, validatedIndex] = fullProtocol.validate(sequence, 0);
        console.log('isValid: ' + isValid, '| validatedIndex: ' + validatedIndex, '| refers to: ' + sequence[validatedIndex]?.name);
        
        if (!isValid){
            const statement = calls[validatedIndex];
            if (!statement) return;
            const call = nodeMapper.statementToCall(statement);
            if (!call) return;
            if (statement) {
                accept('warning',
                    'The pipeline does not follow the recommended behaviour protocol.', {
                        node: call,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            }
        }
    }
};



const fullProtocol = new SequenceBlock([
// Pre-Processing Layer
    // Data Acquisition
    new RepetitionBlock(
        new ElementaryBlock('DataAcquisition'),
        1
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('Preprocessing'),
            new ElementaryBlock('DataAcquisition'),
            new ElementaryBlock('AcquisitionAndEngineering')],
            'or'
        )
    ),

    // Data Preparation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('DataPreparation'),
            new ElementaryBlock('Exploration'),
            new ElementaryBlock('Preprocessing'),
            new ElementaryBlock('PreparationAndEngineering'),
            new ElementaryBlock('PreparationProcessingAndEngineering')],
            'or'
        )
    ),

    // Data Partioning
    new RepetitionBlock(
        new ElementaryBlock('DataPartitioning'),
        1
    ),

    // Data Processing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('DataProcessing'),
            new ElementaryBlock('DataTransformer'),
            new ElementaryBlock('Exploration'),
            new ElementaryBlock('PreparationAndProcessing'),
            new ElementaryBlock('PreparationProcessingAndEngineering')], 
            'or'
        )
    ),
    
// Model Building Layer
    // Feature Engineering
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('FeatureEngineering'),
            new ElementaryBlock('FeatureTransformer'),
            new ElementaryBlock('Exploration'),
            new ElementaryBlock('AcquisitionAndEngineering'),
            new ElementaryBlock('PreparationProcessingAndEngineering')], 
            'or'
        )
    ),

    // Feature Selection
    new RepetitionBlock(
        new ElementaryBlock('FeatureSelection')
    ),

    // Modeling
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('Modeling'),
            new ElementaryBlock('ModelingQClassification'),
            new ElementaryBlock('ModelingQRegression'),
            new ElementaryBlock('ModelingQNeuralNetwork')],
            'or'
        ),  1
    ),

    // Training
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('Training'),
            new ElementaryBlock('TrainingQClassification'),
            new ElementaryBlock('TrainingQRegression'),
            new ElementaryBlock('TrainingQNeuralNetwork')],
            'or'
        ),  1
    ),

    // Prediction
    new RepetitionBlock(
        new ElementaryBlock('Prediction')
    ),

    // Evaluation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('EvaluationQMetric'),
            new ElementaryBlock('EvaluationQVisualization')],
            'or'
        ),  1
    ),

    // Testing
    new RepetitionBlock(
        new ElementaryBlock('EvaluationQMetric'),
        1
    ),

// Post-Processing Layer
    // Interpretation
    new RepetitionBlock(
        new ElementaryBlock('EvaluationQVisualization'),
        1
    ),
])

