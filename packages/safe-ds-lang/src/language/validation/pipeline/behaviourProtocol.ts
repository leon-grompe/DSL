import { ValidationAcceptor } from 'langium';
import { isSdsClass, isSdsFunction, SdsAnnotatedObject, SdsPipeline, SdsStatement } from '../../generated/ast.js';
import { SafeDsServices } from '../../index.js';

export const CODE_PIPELINE_BEHAVIOUR_PROTOCOL = 'pipeline/behaviour-protocol';

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
        // operatoren:
        // sequenz, wiederholung, alternative
        /*
        phases = []
        -> alles was gleichzeitig kann, kommt in ein array
        -> wenn etwas passieren muss: muss das beim traversieren gecheckt werden?
        */
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

export interface Phase {
    name: string;
}
/**
 * Abstract base class for protocol blocks.
 * Protocol Blocks can be elementary, sequences of blocks, repetitions of a block, or alternatives between blocks.
 * Using these Blocks a regular expression like structure can be created to define the valid sequences of phases in a pipeline.
 */
export abstract class ProtocolBlock {
    constructor(){}

    /**
     * Validates a sequence of phases against the protocol block.
     * @param sequence The sequence of phases to validate.
     * @param startIndex The index to start validation from.
     * @returns A tuple indicating if the validation was successful and the index of the next phase to validate.
     */
    abstract validate(sequence: Phase[], startIndex: number) : [boolean, number];
}

/**
 * Represents an elementary block in the behaviour protocol, which corresponds to a single phase.
 */
export class ElementaryBlock extends ProtocolBlock{
    constructor(
        public phase: string,

    ){ super() }

    validate(sequence: Phase[], startIndex: number) : [boolean, number] {
        if (startIndex >= sequence.length) {
            return [false, startIndex];
        }
        const currentPhase = sequence[startIndex];
        if (currentPhase?.name === this.phase){
            return [true, startIndex + 1];
        }
        return [false, startIndex];
    }
}

/**
 * Represents a sequence of protocol blocks, where each block must be validated in order.
 */
export class SequenceBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
    ){ super() }

    validate(sequence: Phase[], startIndex: number) : [boolean, number] {
        let updatedStartingPoint = 0;
        for (const block of this.blocks){
            const [isValid, validatedIndex] = block.validate(sequence, startIndex + updatedStartingPoint); 
            if(!isValid){
                return [false, updatedStartingPoint];
            }
            updatedStartingPoint = validatedIndex;
        }
        return [true, updatedStartingPoint];
    }
}   

/**
 * Represents a repetition of a protocol block, where the block must be validated a certain number of times (between min and max).
 */
export class RepetitionBlock extends ProtocolBlock{
    constructor(
        public block: ProtocolBlock,
        public min: number = 0,
        public max: number = Infinity,

    ){ super() }

    validate(sequence: Phase[], startIndex: number) : [boolean, number] {
        let updatedStartingPoint = 0;
        let counter = this.min;
        while(counter <= this.max){
            const [isValid, validatedIndex] = this.block.validate(sequence, startIndex + updatedStartingPoint);
            if(!isValid){
                return [false, updatedStartingPoint];
            }
            updatedStartingPoint = validatedIndex;
            counter++;
        }
        return [true, updatedStartingPoint];
    }
}

/**
 * Represents an alternative between multiple protocol blocks, with the relation being either 'or' or 'xor'.
 */
export class AlternativeBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
        public relation: 'or' | 'xor',
    ){ super() }

    validate(sequence: Phase[], startIndex: number) : [boolean, number] {
        switch(this.relation){
            case 'or': {
                for (const block of this.blocks){
                    const [isValid, validatedIndex] = block.validate(sequence, startIndex);
                    if(isValid){
                        return [true, validatedIndex];
                    }
                }
            }
            case 'xor': {
                let validCount = 0;
                let lastValidIndex = startIndex;
                for (const block of this.blocks){
                    const [isValid, validatedIndex] = block.validate(sequence, startIndex);
                    if(isValid){
                        validCount++;
                        lastValidIndex = validatedIndex;
                    }
                }
                if (validCount === 1){
                    return [true, lastValidIndex];
                }
            }
        }
        return [false, startIndex];
    }
}






const protocol = new SequenceBlock([
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

    // Interpretation
    new RepetitionBlock(
        new ElementaryBlock('EvaluationQVisualization'),
        1
    ),
])

