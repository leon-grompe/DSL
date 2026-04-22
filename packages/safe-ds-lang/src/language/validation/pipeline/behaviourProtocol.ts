import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsStatement } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { ProtocolBlock, ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock, Phase, ValidationResult, ValidationError } from './model.js';
import { error } from 'console';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        const calls = [] as SdsCall[];
        const sequence = [] as Phase[];
        
        // fill the sequence of found calls in the pipeline
        for (const statement of node.body.statements){
            const statementCalls = nodeMapper.statementToCalls(statement);

            for (const call of statementCalls){
                calls.push(call);
                
                // for each call, find the corresponding annotation and add it to the sequence
                // if no annotation is found, add the phase 'Any' instead
                const callable = nodeMapper.callToCallable(call);
                if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

                const annotation = builtinAnnotations.getDSPipelinePhase(callable as SdsAnnotatedObject);
                sequence.push(annotation ? new Phase(annotation.name) : new Phase('Any'));
            }
        }

        const result = fullProtocol.validate(sequence, 0);
        
        if (!result.isValid){
            const validationMessage = computeValidationMessage(result)

            const call = calls[result.validatedIndex];

            if (!call) {
                accept('warning',
                    validationMessage, {
                        node: calls.at(calls.length-1) ?? node,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                )
                return;
            };
            
            accept('warning',
                validationMessage, {
                    node: call,
                    code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                },
            );
        };
    };
};

const computeValidationMessage = (result: ValidationResult): string => {
    const nestedErrors = extractNestedValidationErrors(result);
    const messages: string[] = [];
    for (const error of nestedErrors){
        switch (error.type){
            case 'elem-block-phase-mismatch': {
                messages.push(`Expected phase '${error.expected.name}' but found '${error.found.name}'`);
                break;
            }
            case 'elem-block-oob': {
                messages.push('Pipeline ended unexpectedly');
                break;
            }
            case 'alternative-block-no-match': {
                messages.push('None of the allowed phases matched');
                break;
            }
            case 'or-block-no-match': {
                messages.push('None of the optional phases were found');
                break;
            }
            case 'xor-block-multiple-matches': {
                messages.push('Multiple exclusive phases were found (expected exactly one)');
                break;
            }
            case 'repetition-block-minimum-not-met': {
                const blockName = error.name ? ` '${error.name}'` : '';
                messages.push(`Block${blockName} requires at least ${error.min} occurrences but found ${error.actual}`);
                break;
            }
            case 'sequence-block-failed': {  
                break;
            }
        }
    }
    return messages.join('; ');
}

const extractNestedValidationErrors = (result: ValidationResult): ValidationError[] => {
    const errors = [] as ValidationError[];
    while (result.baseError){
        if(result.error){
            errors.push(result.error);
        }
        result = result.baseError;
    }
    return errors;
}

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

