import { ProtocolBlock, ElementaryBlock, AlternativeBlock, RepetitionBlock, SequenceBlock, Activity, DataSet } from './model.js';

/** 
 * Full behaviour protocol based on best practices and common data science pitfalls.
 * A pipeline should follow this protocol to prevent domain specific mistakes like data leakage.
*/
export const behaviourProtocol = new SequenceBlock([
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
            new ElementaryBlock( new Activity('DataProcessingQExploration'), 
                                 DataSet.Training),
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
            new ElementaryBlock( new Activity('EvaluationQMetric'),
                                 DataSet.Validation), 
            new ElementaryBlock( new Activity('EvaluationQVisualization'),
                                 DataSet.Validation )],
            'or'
        ),  'Evaluation', 1, Infinity, DataSet.Test
    ),

    // Testing
    new RepetitionBlock(
        new AlternativeBlock([
            new ElementaryBlock( new Activity('TestingQMetric'), 
                                 DataSet.Test), 
            new ElementaryBlock( new Activity('TestingQVisualization'), 
                                 DataSet.Test)],
            'or'
        ),  'Testing'
    ),
])