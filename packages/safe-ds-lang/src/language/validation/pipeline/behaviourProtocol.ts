import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsPlaceholder } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { ProtocolBlock, ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock, Activity } from './model.js';
import { ValidationResult, ValidationError} from './validationDataStructures.js'


export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        const calls = [] as SdsCall[];
        const sequence = [] as Activity[];
        
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
                sequence.push(annotation ? new Activity(annotation.name) : new Activity('Any'));
            }
        }

        const result = behaviourProtocol.validate(sequence, 0);
        
        if (!result.isValid){
            

            const call = calls[result.validatedIndex];

            // mistake is inside the pipeline => validation message on wrong call
            if (call) {
                const validationMessage = computeValidationMessage(result)
                accept('warning',
                    validationMessage, {
                        node: call,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            }
            // something is missing at the end of the pipeline => validation message on the end of the pipeline
            // TODO: generate different message to better explain what is missing
            //      "after this statement continuation of previous phase or next phase expected"
            else {
                const specialValidationMessage = computeValidationMessage(result)
                accept('warning',
                    specialValidationMessage, {
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
    let phase: string = '';

    for (const error of nestedErrors){
        switch (error.type){
            case 'elem-block-phase-mismatch': {
                messages.push(`Expected activity '${error.expected.activityName}' but found '${error.found.activityName}.'`);
                break;
            }
            case 'elem-block-oob': {
                messages.push('Pipeline ended unexpectedly.');
                break;
            }
            case 'alternative-block-no-match': {
                messages.push('None of the allowed activities in matched.');
                break;
            }
            case 'or-block-no-match': {
                const expectedPhasesString = [] as string[];
                for (const alternative of error.alternatives){
                    expectedPhasesString.push(alternative.activityName);
                }
                console.log(expectedPhasesString);
                // use phase name if possible
                if (phase != ''){
                    messages.push(`Expected one of the following activities during phase ${phase} but found none: ` + expectedPhasesString.map(p => `'${p}'`).join(', ') + '.');
                }
                // use generic phrase otherwise
                else {
                    messages.push('Expected one of the following activities during current phase but found none: ' + expectedPhasesString.map(p => `'${p}'`).join(', ') + '.');
                }
                break;
            }
            case 'xor-block-multiple-matches': {
                messages.push('Multiple exclusive activities were found (expected exactly one).');
                break;
            }
            case 'repetition-block-minimum-not-met': {
                if (error.phaseName){ phase = `'` + error.phaseName + `'`; }
                
                // dont show add message if minimum is less than 1 or no activity detected
                if (error.min > 1 && error.actual > 1){
                    messages.push(`Detected phase ${phase} requires at least ${error.min} occurrences but found ${error.actual}.`);
                }
                break;
            }
            case 'sequence-block-failed': {  
                break;
            }
        }
    }
    return messages.join(' ');
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
        new ElementaryBlock( new Activity('DataAcquisition') ),
        'DataAcquisition', 1
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('Preprocessing') ),
            new ElementaryBlock( new Activity('DataAcquisition') ),
            new ElementaryBlock( new Activity('AcquisitionAndEngineering') )],
            'or'
        ),  'DataAcquisition'
    ),

    // Data Preparation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('DataPreparation') ),
            new ElementaryBlock( new Activity('Exploration') ),
            new ElementaryBlock( new Activity('Preprocessing') ),
            new ElementaryBlock( new Activity('PreparationAndEngineering') ),
            new ElementaryBlock( new Activity('PreparationProcessingAndEngineering') )],
            'or'
        ),  'DataPreparation'
    ),

    // Data Partioning
    new RepetitionBlock(
        new ElementaryBlock( new Activity('DataPartitioning') ),
        'DataPartitioning', 1
    ),

    // Data Processing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('DataProcessing') ),
            new ElementaryBlock( new Activity('DataTransformer') ),
            new ElementaryBlock( new Activity('Exploration') ),
            new ElementaryBlock( new Activity('PreparationAndProcessing') ),
            new ElementaryBlock( new Activity('PreparationProcessingAndEngineering') )], 
            'or'
        ), 'DataProcessing'
    ),
    
// Model Building Layer
    // Feature Engineering
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('FeatureEngineering') ),
            new ElementaryBlock( new Activity('FeatureTransformer') ),
            new ElementaryBlock( new Activity('Exploration') ),
            new ElementaryBlock( new Activity('AcquisitionAndEngineering') ),
            new ElementaryBlock( new Activity('PreparationProcessingAndEngineering') )], 
            'or'
        ), 'FeatureEngineering'
    ),

    // Feature Selection
    new RepetitionBlock(
        new ElementaryBlock( new Activity('FeatureSelection') ),
        'FeatureSelection'
    ),

    // Modeling
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('Modeling') ),
            new ElementaryBlock( new Activity('ModelingQClassification') ),
            new ElementaryBlock( new Activity('ModelingQRegression') ),
            new ElementaryBlock( new Activity('ModelingQNeuralNetwork') )],
            'or'
        ),  'Modeling', 1
    ),

    // Training
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('Training') ),
            new ElementaryBlock( new Activity('TrainingQClassification') ),
            new ElementaryBlock( new Activity('TrainingQRegression') ),
            new ElementaryBlock( new Activity('TrainingQNeuralNetwork') )],
            'or'
        ),  'Training', 1
    ),

    // Prediction
    new RepetitionBlock(
        new ElementaryBlock( new Activity('Prediction') ),
        'Prediction'
    ),

    // Evaluation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('EvaluationQMetric') ),
            new ElementaryBlock( new Activity('EvaluationQVisualization') )],
            'or'
        ),  'Evaluation', 1
    ),

    // Testing
    new RepetitionBlock(
        new ElementaryBlock( new Activity('EvaluationQMetric') ),
        'Testing', 1
    ),

// Post-Processing Layer
    // Interpretation
    new RepetitionBlock(
        new ElementaryBlock( new Activity('EvaluationQVisualization') ),
        'Interpretation', 1
    ),
])

