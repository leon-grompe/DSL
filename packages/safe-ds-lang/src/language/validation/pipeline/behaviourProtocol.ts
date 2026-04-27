import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsPlaceholder } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { ProtocolBlock, ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock, Phase } from './model.js';
import { ValidationResult, ValidationError} from './validationDataStructures.js'
import { SafeDsSlicer } from '../../flow/safe-ds-slicer.js'

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

        const result = behaviourProtocol.validate(sequence, 0);
        
        if (!result.isValid){
            const validationMessage = computeValidationMessage(result)

            const call = calls[result.validatedIndex];

            // mistake is inside the pipeline => validation message on wrong call
            if (call) {
                accept('warning',
                    validationMessage, {
                        node: call,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            }
            // something is missing at the end of the pipeline => validation message on the end of the pipeline
            else {
                accept('warning',
                    validationMessage, {
                        node: calls.at(calls.length-1) ?? node,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            }
            return;
        };
    };
};

// new idea: aggregate a map of <call, pipeline layer (name of repetition block)> while validating
// split map in layers
// check each layer for specific calls:
//      Processing: exploration (only on training)
//      Prediction: general (only on validation)
//      Evaluation: evaluation (only on validation)
//      Testing: evaluation (only on test)
//      

/**
 * however this approach has the problem, that the validation of the behaviour protocol stops immediatly once an violation 
 * has been found. therefore the calls after the violation can not be mapped to a pipeline layer.
 * 
 * also, evaluation and testing only differ in the set used so how does the protocol differentiate?
 */


// possibly different functions for every case?
//      exploration on validation/test data during processing
//      evaluation on training/test data during evaluation
//      evaluation on training/validation data during testing
export const pipelineMustNotAccessDatasetInWrongPhase = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;
    const slicer = services.flow.Slicer;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        const statements = node.body.statements;
        
    }
}


const computeValidationMessage = (result: ValidationResult): string => {
    const nestedErrors = extractNestedValidationErrors(result);
    const messages: string[] = [];

    for (const error of nestedErrors){
        switch (error.type){
            case 'elem-block-phase-mismatch': {
                messages.push(`Expected phase '${error.expected.name}' but found '${error.found.name}.'`);
                break;
            }
            case 'elem-block-oob': {
                messages.push('Pipeline ended unexpectedly.');
                break;
            }
            case 'alternative-block-no-match': {
                messages.push('None of the allowed phases matched.');
                break;
            }
            case 'or-block-no-match': {
                const expectedPhasesString = [] as string[];
                for (const alternative of error.alternatives){
                    expectedPhasesString.push(alternative.name);
                }
                console.log(expectedPhasesString);
                messages.push('Expected one of the following phases but found none: ' + expectedPhasesString.map(p => `'${p}'`).join(', '));
                break;
            }
            case 'xor-block-multiple-matches': {
                messages.push('Multiple exclusive phases were found (expected exactly one).');
                break;
            }
            case 'repetition-block-minimum-not-met': {
                const blockName = error.name ? ` '${error.name}'` : '';
                messages.push(`Block${blockName} requires at least ${error.min} occurrences but found ${error.actual}.`);
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
    let current: ValidationResult | undefined = result;
    while (current) {
        if (current.error) {
            errors.push(current.error);
        }
        current = current.baseError;
    }
    return errors;
}


/** 
 * Full behaviour protocol based on best practices and common data science pitfalls.
 * A pipeline should follow this protocol to prevent domain specific mistakes like data leakage.
*/
const behaviourProtocol = new SequenceBlock([
// Pre-Processing Layer
    // Data Acquisition
    new RepetitionBlock(
        new ElementaryBlock( new Phase('DataAcquisition') ),
        'DataAcquisition', 1
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Phase('Preprocessing') ),
            new ElementaryBlock( new Phase('DataAcquisition') ),
            new ElementaryBlock( new Phase('AcquisitionAndEngineering') )],
            'or'
        ),  'DataAcquisition'
    ),

    // Data Preparation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Phase('DataPreparation') ),
            new ElementaryBlock( new Phase('Exploration') ),
            new ElementaryBlock( new Phase('Preprocessing') ),
            new ElementaryBlock( new Phase('PreparationAndEngineering') ),
            new ElementaryBlock( new Phase('PreparationProcessingAndEngineering') )],
            'or'
        ),  'DataPreparation'
    ),

    // Data Partioning
    new RepetitionBlock(
        new ElementaryBlock( new Phase('DataPartitioning') ),
        'DataPartitioning', 1
    ),

    // Data Processing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Phase('DataProcessing') ),
            new ElementaryBlock( new Phase('DataTransformer') ),
            new ElementaryBlock( new Phase('Exploration') ),
            new ElementaryBlock( new Phase('PreparationAndProcessing') ),
            new ElementaryBlock( new Phase('PreparationProcessingAndEngineering') )], 
            'or'
        ), 'DataProcessing'
    ),
    
// Model Building Layer
    // Feature Engineering
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Phase('FeatureEngineering') ),
            new ElementaryBlock( new Phase('FeatureTransformer') ),
            new ElementaryBlock( new Phase('Exploration') ),
            new ElementaryBlock( new Phase('AcquisitionAndEngineering') ),
            new ElementaryBlock( new Phase('PreparationProcessingAndEngineering') )], 
            'or'
        ), 'FeatureEngineering'
    ),

    // Feature Selection
    new RepetitionBlock(
        new ElementaryBlock( new Phase('FeatureSelection') ),
        'FeatureSelection'
    ),

    // Modeling
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Phase('Modeling') ),
            new ElementaryBlock( new Phase('ModelingQClassification') ),
            new ElementaryBlock( new Phase('ModelingQRegression') ),
            new ElementaryBlock( new Phase('ModelingQNeuralNetwork') )],
            'or'
        ),  'Modeling', 1
    ),

    // Training
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Phase('Training') ),
            new ElementaryBlock( new Phase('TrainingQClassification') ),
            new ElementaryBlock( new Phase('TrainingQRegression') ),
            new ElementaryBlock( new Phase('TrainingQNeuralNetwork') )],
            'or'
        ),  'Training', 1
    ),

    // Prediction
    new RepetitionBlock(
        new ElementaryBlock( new Phase('Prediction') ),
        'Prediction'
    ),

    // Evaluation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Phase('EvaluationQMetric') ),
            new ElementaryBlock( new Phase('EvaluationQVisualization') )],
            'or'
        ),  'Evaluation', 1
    ),

    // Testing
    new RepetitionBlock(
        new ElementaryBlock( new Phase('EvaluationQMetric') ),
        'Testing', 1
    ),

// Post-Processing Layer
    // Interpretation
    new RepetitionBlock(
        new ElementaryBlock( new Phase('EvaluationQVisualization') ),
        'Interpretation', 1
    ),
])

