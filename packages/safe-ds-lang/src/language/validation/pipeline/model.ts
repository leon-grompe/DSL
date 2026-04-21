import { result } from "true-myth";

export type ValidationError =
    | {type: 'sequence-block-failed'; name?: string }     
    
    | {type: 'elem-block-oob' }
    | {type: 'elem-block-phase-mismatch'; expected: Phase; found: Phase }
    
    | {type: 'alternative-block-no-match'}
    | {type: 'or-block-no-match'}
    | {type: 'xor-block-multiple-matches'}
    
    | {type: 'repetition-block-minimum-not-met'; min: number; actual: number }


export class ValidationResult {
    public readonly isValid: boolean;
    public readonly validatedIndex: number;
    public readonly error?: ValidationError;
    public readonly baseError?: ValidationResult;
    
    private constructor (isValid: boolean, validatedIndex: number, error?: ValidationError, baseError?: ValidationResult){
        this.isValid = isValid;
        this.validatedIndex = validatedIndex;
        this.baseError = baseError;
        this.error = error;
    }

    static success(validatedIndex: number, baseError?: ValidationResult): ValidationResult {
        return new ValidationResult(true, validatedIndex, undefined, baseError);
    }
    
    static failure(validatedIndex: number, error?: ValidationError, baseError?: ValidationResult): ValidationResult {
        return new ValidationResult(false, validatedIndex, error, baseError);
    }
}



export class Phase {
    constructor(
        public name: string,
    ){}
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
    abstract validate(sequence: Phase[], startIndex: number) : ValidationResult;
}

/**
 * Represents an elementary block in the behaviour protocol, which corresponds to a single phase.
 * Also allows the use of a wildcard phase 'Any' which can match any phase in the sequence.
 */
export class ElementaryBlock extends ProtocolBlock{
    constructor(
        public phase: string,

    ){ super() }

    validate(sequence: Phase[], startIndex: number) : ValidationResult {
        if (startIndex >= sequence.length) {
            return ValidationResult.failure(startIndex, {type: 'elem-block-oob'});
        }
        const currentPhase = sequence[startIndex];
        if (currentPhase?.name === this.phase || currentPhase?.name === 'Any'){
            return ValidationResult.success(startIndex + 1);
        }
        return ValidationResult.failure(startIndex, {
            type: 'elem-block-phase-mismatch', 
            expected: new Phase(this.phase), 
            found: currentPhase ?? new Phase('EndOfSequence')
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

    validate(sequence: Phase[], startIndex: number) : ValidationResult {
        let updatedStartingPoint = 0;
        for (const block of this.blocks){
            const result = block.validate(sequence, updatedStartingPoint);
            if(!result.isValid){
                // console.log('Validation failed at block:', block, '| sequence phase was:', sequence[updatedStartingPoint]);
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
        public min: number = 0,
        public max: number = Infinity,
        public name?: string,

    ){ super() }

    validate(sequence: Phase[], startIndex: number) :ValidationResult {
        let currentIndex = startIndex;
        
        // enforce the minimum required matches
        for (let counter = 0; counter < this.min; counter++) {
            const result = this.block.validate(sequence, currentIndex);
            if (!result.isValid) {
                // TODO: currently this also triggers for min=1 when current block doesnt have anything to do with the repetition and is just blatantly wrong. 
                // this should not trigger in this case, instead  the error of the elementary block should be shown
                // QUESTION: how to differentiate between the cases? 
                return ValidationResult.failure(result.validatedIndex, {
                    type: 'repetition-block-minimum-not-met',
                    min: this.min,
                    actual: counter,
                },  result );
            }
            currentIndex = result.validatedIndex;
        }
        
        // optionally match more times up to max
        for (let counter = this.min; counter < this.max; counter++) {
            const result = this.block.validate(sequence, currentIndex);
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

    validate(sequence: Phase[], startIndex: number) : ValidationResult {
        switch(this.relation){
            case 'or': {
                for (const block of this.blocks){
                    const result = block.validate(sequence, startIndex);
                    if(result.isValid){
                        return result;
                    }
                }
                return ValidationResult.failure(startIndex, {type: 'or-block-no-match'});
            }
            case 'xor': {
                let validCount = 0;
                let lastValidIndex = startIndex;
                for (const block of this.blocks){
                    const result = block.validate(sequence, startIndex);
                    if(result.isValid){
                        validCount++;
                        lastValidIndex = result.validatedIndex;
                    }
                }
                if (validCount === 1){
                    return ValidationResult.success(lastValidIndex);
                }
                if (validCount > 1){
                    return ValidationResult.failure(startIndex, {type: 'xor-block-multiple-matches'});
                }
            }
        }
        return ValidationResult.failure(startIndex, {type: 'alternative-block-no-match'});       
    }
}