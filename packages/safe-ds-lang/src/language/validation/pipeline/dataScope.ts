// DataScope for variable tracking
export enum DataScope {
    Original = 'Original',
    Training = 'Training',
    Test = 'Test',
    Validation = 'Validation',
}

// Allowed phases for each data scope
export const AllowedPhasesForScope: Record<DataScope, string[]> = {
    [DataScope.Original]: [
        'DataAcquisition', 'Preprocessing', 'DataPreparation', 'Exploration',
        'AcquisitionAndEngineering', 'PreparationAndEngineering', 'PreparationProcessingAndEngineering',
        'DataPartitioning', 'DataProcessing', 'DataTransformer', 'PreparationAndProcessing',
    ],
    [DataScope.Training]: [
        'FeatureEngineering', 'FeatureTransformer', 'Exploration', 'AcquisitionAndEngineering',
        'PreparationProcessingAndEngineering', 'FeatureSelection', 'Modeling', 'ModelingQClassification',
        'ModelingQRegression', 'ModelingQNeuralNetwork', 'Training', 'TrainingQClassification',
        'TrainingQRegression', 'TrainingQNeuralNetwork', 'Prediction', 'EvaluationQMetric', 'EvaluationQVisualization',
    ],
    [DataScope.Test]: [
        'Prediction', 'EvaluationQMetric', 'EvaluationQVisualization', 'Testing', 'Interpretation',
    ],
    [DataScope.Validation]: [
        'Training', 'Prediction', 'EvaluationQMetric', 'EvaluationQVisualization',
    ],
};