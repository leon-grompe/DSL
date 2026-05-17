import { ValidationError, ValidationResult } from './validationDataStructures.js'
import { SafeDsServices } from '../../safe-ds-module.js';
import { SdsCall } from '../../generated/ast.js';
import { SafeDsDataFlowAnalyzer } from '../../flow/safe-ds-data-flow-analyzer.js';

// DataSet for variable tracking
export enum DataSet {
    Original = 'Original',
    Training = 'Training',
    Test = 'Test',
    Validation = 'Validation',
}

export class Activity {
    constructor(
        public activityName: string,
    ){}
}

export class ValidationContext {
    constructor(
        public activitySequence: Activity[][],
        public calls: SdsCall[]
    ){}
}

/**
 * Abstract base class for protocol blocks.
 * Protocol Blocks can be elementary, sequences of blocks, repetitions of a block, or alternatives between blocks.
 * Using these Blocks a regular expression like structure can be created to define the valid sequences of activities in a pipeline.
 */
export abstract class ProtocolBlock {
    constructor(){}

    /**
     * Validates a sequence of activities against the protocol block.
     * @param sequence The sequence of activities to validate.
     * @param startIndex The index to start validation from.
     * @returns A tuple indicating if the validation was successful and the index of the next activity to validate.
     */
    abstract validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult;
    
    protected containsDatasetMismatch(result: ValidationResult): boolean {
        let current: ValidationResult | undefined = result;
        while (current) {
            if (current.error?.type === 'dataset-mismatch') return true;
            current = current.baseError;
        }
        return false;
    }
}

/**
 * Represents an elementary block in the behaviour protocol, which corresponds to a single activity.
 * Also allows the use of a wildcard activity 'Any' which can match any activity in the sequence.
 */
export class ElementaryBlock extends ProtocolBlock{
    constructor(
        public activity: Activity,
        public target?: DataSet,
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        const analyzer = services.flow.DataFlowAnalyzer;
        
        if (startIndex > context.activitySequence.length) {
            return ValidationResult.failure(startIndex, {type: 'elem-block-oob'});
        }
        
        const currentActivities = context.activitySequence[startIndex];
        const match = currentActivities?.some(
            activity => activity.activityName === this.activity.activityName
                    ||  activity.activityName === 'Any' 
        )
        
        if (match) {
            // check if only target dataset is used
            if (this.target){
                const currentCall = context.calls[startIndex];
                if (!currentCall) {
                    return ValidationResult.success(startIndex + 1);
                }
                const datasetResult = this.handleDatasetMismatch(startIndex, currentCall, analyzer);
                if (!datasetResult.isValid){
                    return datasetResult;
                }
            }
            return ValidationResult.success(startIndex + 1);
        } else {
            return ValidationResult.failure(startIndex, {
                type: 'elem-block-activity-mismatch', 
                expected: new Activity(this.activity.activityName), 
                found: currentActivities ?? [new Activity('EndOfPipeline')]
            });
        }
    }

    private handleDatasetMismatch(startIndex: number, currentCall: SdsCall, analyzer: SafeDsDataFlowAnalyzer) : ValidationResult {
        const isTraining = analyzer.callReferencesTrainingSet(currentCall);
        const isValidation = analyzer.callReferencesValidationSet(currentCall);
        const isTest = analyzer.callReferencesTestSet(currentCall);

        if(this.target === DataSet.Training){ 
            if (!isTraining){
                const actual = isValidation ? DataSet.Validation : isTest ? DataSet.Test : DataSet.Original;

                return this.returnDatasetMismatch(startIndex, this.target, actual);
            }
        } else if (this.target === DataSet.Validation) { 
            if (!isValidation){
                const actual = isTraining ? DataSet.Training : isTest ? DataSet.Test : DataSet.Original;

                return this.returnDatasetMismatch(startIndex, this.target, actual);
            }
        } else if (this.target === DataSet.Test) {
            if (!isTest){
                const actual = isTraining ? DataSet.Training : isValidation ? DataSet.Validation : DataSet.Original;

                return this.returnDatasetMismatch(startIndex, this.target, actual);
            }
        }
        return ValidationResult.success(startIndex + 1);
    }

    private returnDatasetMismatch(startIndex: number, expected: DataSet, actual: DataSet) : ValidationResult {
        return ValidationResult.failure(startIndex, {
            type: 'dataset-mismatch',
            expected: expected,
            found: actual
        })
    }
}

/**
 * Represents a sequence of protocol blocks, where each block must be validated in order.
 */
export class SequenceBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        let updatedStartingPoint = startIndex;
        for (const block of this.blocks){
            const result = block.validate(context, updatedStartingPoint, services);
            if(!result.isValid){
                return ValidationResult.failure(result.validatedIndex, {
                    type: 'sequence-block-failed',
                },  result);
            }
            // Identify Phase length
            else {
                const phaseEnd = context.calls[result.validatedIndex]
                if (block instanceof RepetitionBlock){
                    console.log("Phase: " + block.phaseName + "| until line:  " + phaseEnd?.$cstNode?.range.end.line)
                }
            }
            
            if (result.validatedIndex > updatedStartingPoint) {
                updatedStartingPoint = result.validatedIndex;
            }
        }
        return ValidationResult.success(updatedStartingPoint);
    }
}   

/**
 * Represents a repetition of a protocol block, where the block must be validated a certain number of times (between min and max).
 */
export class RepetitionBlock extends ProtocolBlock{
    constructor(
        public block: ProtocolBlock,
        public phaseName?: string,
        public min: number = 0,
        public max: number = Infinity,
        public exitDataset?: DataSet,
    ){ super() }

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        let currentIndex = startIndex;
        
        // enforce the minimum required matches
        for (let counter = 0; counter < this.min; counter++) {
            const result = this.block.validate(context, currentIndex, services);
            if (!result.isValid) {
                return ValidationResult.failure(result.validatedIndex, {
                    type: 'repetition-block-minimum-not-met',
                    min: this.min,
                    actual: counter,
                    phaseName: this.phaseName,
                },  result );
            }
            currentIndex = result.validatedIndex;
        }
        
        // optionally match more times up to max
        for (let counter = this.min; counter < this.max; counter++) {
            // lookahead to check if the mistake is that the phase ended and the next phase started
            if (this.exitDataset && currentIndex < context.calls.length) {
                const nextCall = context.calls[currentIndex];
                const analyzer = services.flow.DataFlowAnalyzer;
                if (!nextCall) break; 
                
                const isNextOnExitSet = this.callUsesDataset(nextCall, this.exitDataset, analyzer);
                if (isNextOnExitSet) break;
            }
            
            // propagate validation?
            const result = this.block.validate(context, currentIndex, services);
            if (!result.isValid) { 
                if (this.containsDatasetMismatch(result)) {
                    return ValidationResult.failure(result.validatedIndex, {
                        type: 'repetition-block-minimum-not-met',
                        min: this.min,
                        actual: counter,
                        phaseName: this.phaseName,
                    }, result);  
                }  
                break;       
            }
            currentIndex = result.validatedIndex;
        }
        return ValidationResult.success(currentIndex);

        // optionally match more times up to max
        for (let counter = this.min; counter < this.max; counter++) {
            const result = this.block.validate(context, currentIndex, services);
            if (!result.isValid) {
                
                if (this.containsDatasetMismatch(result)) {
                    return ValidationResult.failure(result.validatedIndex, {
                        type: 'repetition-block-minimum-not-met',
                        min: this.min,
                        actual: counter,
                        phaseName: this.phaseName,
                    }, result);
                }
                break;
            }
            currentIndex = result.validatedIndex;
        }
        
        return ValidationResult.success(currentIndex);
    }
    private callUsesDataset = (
        call: SdsCall, 
        target: DataSet, 
        analyzer: SafeDsDataFlowAnalyzer
    ): boolean => {
        switch(target) {
            case DataSet.Training:   return analyzer.callReferencesTrainingSet(call);
            case DataSet.Validation: return analyzer.callReferencesValidationSet(call);
            case DataSet.Test:       return analyzer.callReferencesTestSet(call);
            default:                 return false;
        }
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

    validate(context: ValidationContext, startIndex: number, services: SafeDsServices) : ValidationResult {
        const alternatives = this.blocks
            .filter(b => b instanceof ElementaryBlock)
            .map(b => (b as ElementaryBlock).activity);
        
        
        switch(this.relation){
            case 'or': {
                for (const block of this.blocks) {
                    const result = block.validate(context, startIndex, services);
                    if (result.isValid) return result;
                    if (this.containsDatasetMismatch(result)) {
                        // Wrap statt direkter Return: or-block-no-match als äußerer Fehler
                        return ValidationResult.failure(startIndex, {
                            type: 'or-block-no-match',
                            alternatives: alternatives
                        }, result); // ← result als baseError
                    }
                }
                return ValidationResult.failure(startIndex, {
                    type: 'or-block-no-match',
                    alternatives: alternatives
                });
            }

            case 'xor': {
                let validCount = 0;
                let lastValidIndex = startIndex;
                for (const block of this.blocks) {
                    const result = block.validate(context, startIndex, services);
                    // break early if dataset mismatch detected
                    if (this.containsDatasetMismatch(result)) {
                        return result;
                    } 
                    if (result.isValid) {
                        validCount++;
                        lastValidIndex = result.validatedIndex;
                    }
                }
                if (validCount === 1){
                    return ValidationResult.success(lastValidIndex);
                }
                if (validCount > 1){
                    return ValidationResult.failure(startIndex, {
                        type: 'xor-block-multiple-matches',
                        alternatives: alternatives
                    });
                }
                break;
            }
        }
        return ValidationResult.failure(startIndex, {
            type: 'alternative-block-no-match',
            alternatives: alternatives
        });       
    }
}


