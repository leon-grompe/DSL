import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsCall, SdsPipeline, SdsPlaceholder } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';
import { ProtocolBlock, ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock, Activity, ValidationContext } from './model.js';
import { ValidationResult, ValidationError} from './validationDataStructures.js'

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

export const pipelineMustFollowBehaviourProtocol = (services: SafeDsServices) => {
    const nodeMapper = services.helpers.NodeMapper;
    const builtinAnnotations = services.builtins.Annotations;

    return (node: SdsPipeline, accept: ValidationAcceptor) => {
        // skip this validation if the pipeline is empty to avoid confusion with other validations
        if (node.body.statements.length < 1){ return; }

        const calls = [] as SdsCall[];
        const sequence = [] as Activity[][];
        
        // fill the sequence of found calls in the pipeline
        for (const statement of node.body.statements){
            const statementCalls = nodeMapper.statementToCalls(statement);

            for (const call of statementCalls){
                calls.push(call);
                
                // for each call, find the corresponding annotations and add an array of them to the sequence
                // if no annotation is found, add an array with singular activity 'Any' instead
                const callable = nodeMapper.callToCallable(call);
                if (!callable || !(isSdsFunction(callable) || isSdsClass(callable))) continue;

                const annotations = builtinAnnotations
                    .streamDSPipelineActivities(callable as SdsAnnotatedObject)
                    .map(variant => variant.name)
                    .toArray();

                const activities = annotations.length > 0
                    ? annotations.map(name => new Activity(name))
                    : [new Activity('Any')];
                
                sequence.push(activities);
            }
        }
        const context = new ValidationContext(sequence, calls)

        const result = behaviourProtocol.validate(context, 0, services);
        
        if (!result.isValid){
            const call = calls[result.validatedIndex];
            const validationMessage = computeValidationMessage(result)
            
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
                    'Pipeline is missing at least one phase after this statement. ' + validationMessage, {
                        node: calls.at(calls.length-1) ?? node,
                        code: CODE_PIPELINE_BEHAVIOUR_PROTOCOL,
                    },
                );
            }
            return;
        };
    };
};




export const pipelineMustNotAccessDatasetInWrongActivity = (services: SafeDsServices) => {
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
            case 'elem-block-activity-mismatch': {
                const foundNames = error.found.map((a: Activity) => `'${a.activityName}'`).join(', ');
                messages.push(`Expected activity '${error.expected.activityName}' but found ${foundNames}.`);
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
                const expectedActivitesString = [] as string[];
                for (const alternative of error.alternatives){
                    expectedActivitesString.push(alternative.activityName);
                }

                let subMessage : String = '';
                
                // use phase name if possible
                if (phase != ''){ subMessage = 'phase ' + phase; }
                // use generic phrase otherwise
                else { subMessage = 'current phase'; }
                
                messages.push(`Expected one of the following activities during ${subMessage} but found none: ` + expectedActivitesString.map(p => `'${p}'`).join(', ') + '.');
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
        new ElementaryBlock( new Activity('DataAcquisitionQGeneral') ),
        'DataAcquisition', 1
    ),
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('DataAcquisitionQGeneral') ),
            new ElementaryBlock( new Activity('DataAcquisitionQPreprocessing') ),
            new ElementaryBlock( new Activity('DataAcquisitionQConstruction') )],
            'or'
        ),  'DataAcquisition'
    ),

    // Data Preparation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('DataPreparationQGeneral') ),
            new ElementaryBlock( new Activity('DataPreparationQExploration') ),
            new ElementaryBlock( new Activity('DataPreparationQPreprocessing') ),
            new ElementaryBlock( new Activity('DataPreparationQTransformation') ),
            new ElementaryBlock( new Activity('DataPreparationQModification') )],
            'or'
        ),  'DataPreparation'
    ),

    // Data Partioning
    new RepetitionBlock(
        new ElementaryBlock( new Activity('DataPartitioningQGeneral') ),
        'DataPartitioning', 1
    ),

    // Data Processing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('DataProcessingQGeneral') ),
            new ElementaryBlock( new Activity('DataProcessingQExploration') ),
            new ElementaryBlock( new Activity('DataProcessingQDataTransformer') ),
            new ElementaryBlock( new Activity('DataProcessingQPreprocessing') ),
            new ElementaryBlock( new Activity('DataProcessingQTransformation') ),
            new ElementaryBlock( new Activity('DataProcessingQModification') )], 
            'or'
        ), 'DataProcessing'
    ),
    
// Model Building Layer
    // Feature Engineering
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('FeatureEngineeringQGeneral') ),
            new ElementaryBlock( new Activity('FeatureEngineeringQFeatureTransformer') ),
            new ElementaryBlock( new Activity('FeatureEngineeringQModification') ),
            new ElementaryBlock( new Activity('FeatureEngineeringQConstruction') )], 
            'or'
        ), 'FeatureEngineering'
    ),

    // Feature Selection
    new RepetitionBlock(
        new ElementaryBlock( new Activity('FeatureSelectionQGeneral') ),
        'FeatureSelection'
    ),

    // Modeling
    new RepetitionBlock(
        new ElementaryBlock( new Activity('ModelingQGeneral')),
        'Modeling', 1
    ),

    // Training
    new RepetitionBlock(
        new ElementaryBlock( new Activity('TrainingQGeneral')),
        'Training', 1
    ),

    // Prediction
    new RepetitionBlock(
        new ElementaryBlock( new Activity('PredictionQGeneral') ),
        'Prediction'
    ),

    // Evaluation
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('EvaluationQMetric')), 
            new ElementaryBlock( new Activity('EvaluationQVisualization') )],
            'or'
        ),  'Evaluation', 1
    ),

    // Testing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('TestingQMetric')), 
            new ElementaryBlock( new Activity('TestingQVisualization') )],
            'or'
        ),  'Testing'
    ),


])

