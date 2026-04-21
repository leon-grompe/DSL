import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsStatement } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { ProtocolBlock, ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock, Phase } from './model.js';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // fill the sequence of found calls in the pipeline
        const calls = [] as SdsCall[];
        for (const statement of node.body.statements){
            const statementCalls = nodeMapper.statementToCalls(statement);
            for (const call of statementCalls) {
                calls.push(call);
            }
        }
        
        // for each call, find the corresponding annotation and add it to the sequence
        // if no annotation is found, add the phase 'Any' instead
        const sequence = [] as Phase[];
        for (const call of calls) {
            const callable = nodeMapper.callToCallable(call);
            if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

            const annotation = builtinAnnotations.getDSPipelinePhase(callable as SdsAnnotatedObject);
            if (!annotation) {
                sequence.push(new Phase('Any'));
                continue;
            };
            sequence.push(new Phase(annotation.name));
        }
        
        console.log('Extracted calls:', calls.map(call => call.$type).join(', '));
        // console.log('Sequence of phases in the pipeline:', sequence.map(phase => phase.name).join(', '));

        const result = fullProtocol.validate(sequence, 0);
        // console.log('isValid: ' + result.isValid, '| validatedIndex: ' + result.validatedIndex, '| refers to: ' + sequence[result.validatedIndex]?.name);

        if (!result.isValid){
            const call = calls[result.validatedIndex];
            if (!call) return;
            accept('warning',
                'The pipeline does not follow the recommended behaviour protocol. Error: ' + result.error?.type, {
                    node: call,
                    code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                },
            );
        }
    }
};



const fullProtocol = new SequenceBlock([
// Pre-Processing Layer
    // Data Acquisition
    new RepetitionBlock(
        new ElementaryBlock('DataAcquisition'),
        'DataAcquisition', 1
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('Preprocessing'),
            new ElementaryBlock('DataAcquisition'),
            new ElementaryBlock('AcquisitionAndEngineering')],
            'or'
        ),  'DataAcquisition'
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
        ),  'DataPreparation'
    ),

    // Data Partioning
    new RepetitionBlock(
        new ElementaryBlock('DataPartitioning'),
        'DataPartitioning', 1
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
        ), 'DataProcessing'
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
        ), 'FeatureEngineering'
    ),

    // Feature Selection
    new RepetitionBlock(
        new ElementaryBlock('FeatureSelection'),
        'FeatureSelection'
    ),

    // Modeling
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('Modeling'),
            new ElementaryBlock('ModelingQClassification'),
            new ElementaryBlock('ModelingQRegression'),
            new ElementaryBlock('ModelingQNeuralNetwork')],
            'or'
        ),  'Modeling', 1
    ),

    // Training
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('Training'),
            new ElementaryBlock('TrainingQClassification'),
            new ElementaryBlock('TrainingQRegression'),
            new ElementaryBlock('TrainingQNeuralNetwork')],
            'or'
        ),  'Training',1
    ),

    // Prediction
    new RepetitionBlock(
        new ElementaryBlock('Prediction'),
        'Prediction'
    ),

    // Evaluation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock('EvaluationQMetric'),
            new ElementaryBlock('EvaluationQVisualization')],
            'or'
        ),  'Evaluation',1
    ),

    // Testing
    new RepetitionBlock(
        new ElementaryBlock('EvaluationQMetric'),
        'Testing', 1
    ),

// Post-Processing Layer
    // Interpretation
    new RepetitionBlock(
        new ElementaryBlock('EvaluationQVisualization'),
        'Interpretation', 1
    ),
])

