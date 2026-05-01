import { V } from 'vitest/dist/chunks/reporters.d.BFLkQcL6.js';
import { ValidationResult } from './validationDataStructures.js'
import { start } from 'repl';

export class Activity {
    constructor(
        public activityName: string,
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
    abstract validate(activitySequence: Activity[][], startIndex: number) : ValidationResult;
}

/**
 * Represents an elementary block in the behaviour protocol, which corresponds to a single activity.
 * Also allows the use of a wildcard activity 'Any' which can match any activity in the sequence.
 */
export class ElementaryBlock extends ProtocolBlock{
    constructor(
        public activity: Activity,
        
    ){ super() }

    validate(activitySequence: Activity[][], startIndex: number) : ValidationResult {
        if (startIndex > activitySequence.length) {
            return ValidationResult.failure(startIndex, {type: 'elem-block-oob'});
        }
        
        const currentActivities = activitySequence[startIndex];
        const match = currentActivities?.some(
            activity => activity.activityName === this.activity.activityName
                    ||  activity.activityName === 'Any' 
        )
        if (match) {
            return ValidationResult.success(startIndex + 1);
        }

        return ValidationResult.failure(startIndex, {
            type: 'elem-block-activity-mismatch', 
            expected: new Activity(this.activity.activityName), 
            found: currentActivities ?? [new Activity('EndOfPipeline')]
        });
    }
}

/**
 * Represents a sequence of protocol blocks, where each block must be validated in order.
 */
export class SequenceBlock extends ProtocolBlock{
    constructor(
        public blocks: ProtocolBlock[],
    ){ super() }

    validate(activitySequence: Activity[][], startIndex: number) : ValidationResult {
        let updatedStartingPoint = 0;
        for (const block of this.blocks){
            const result = block.validate(activitySequence, updatedStartingPoint);
            if(!result.isValid){
                return ValidationResult.failure(result.validatedIndex, {
                    type: 'sequence-block-failed',
                },  result);
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
    ){ super() }

    validate(activitySequence: Activity[][], startIndex: number) : ValidationResult {
        let currentIndex = startIndex;
        
        // enforce the minimum required matches
        for (let counter = 0; counter < this.min; counter++) {
            const result = this.block.validate(activitySequence, currentIndex);
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
            const result = this.block.validate(activitySequence, currentIndex);
            if (!result.isValid) {
                break;
            }
            currentIndex = result.validatedIndex;
        }
        
        return ValidationResult.success(currentIndex);
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

    validate(activitySequence: Activity[][], startIndex: number) : ValidationResult {
        const alternatives = this.blocks
            .filter(b => b instanceof ElementaryBlock)
            .map(b => (b as ElementaryBlock).activity);
        
            switch(this.relation){
            case 'or': {
                for (const block of this.blocks){
                    const result = block.validate(activitySequence, startIndex);
                    if(result.isValid) return result;
                }
                // TODO: it would probably help to also include the nested ValidationResults
                return ValidationResult.failure(startIndex, {
                    type: 'or-block-no-match', 
                    alternatives: alternatives
                });
            }

            case 'xor': {
                let validCount = 0;
                let lastValidIndex = startIndex;
                for (const block of this.blocks){
                    const result = block.validate(activitySequence, startIndex);
                    if(result.isValid){
                        validCount++;
                        lastValidIndex = result.validatedIndex;
                    }
                }
                if (validCount === 1){
                    return ValidationResult.success(lastValidIndex);
                }
                if (validCount > 1){
                    // TODO: see above
                    return ValidationResult.failure(startIndex, {
                        type: 'xor-block-multiple-matches',
                        alternatives: alternatives
                    });
                }
            }
        }
        return ValidationResult.failure(startIndex, {
            type: 'alternative-block-no-match',
            alternatives: alternatives
        });       
    }
}