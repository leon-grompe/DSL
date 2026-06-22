/**
 * Encodes the phases in a data science pipeline.
 */
export enum DSPipelinePhase {
    DataAcquisition     = 'DataAcquisition',
    DataPreparation     = 'DataPreparation',
    DataPartitioning    = 'DataPartitioning',
    DataProcessing      = 'DataProcessing',
    FeatureEngineering  = 'FeatureEngineering',
    FeatureSelection    = 'FeatureSelection',
    Modeling            = 'Modeling',
    Training            = 'Training',
    Evaluation          = 'Evaluation',
    Testing             = 'Testing',
    Interpretation      = 'Interpretation'
}