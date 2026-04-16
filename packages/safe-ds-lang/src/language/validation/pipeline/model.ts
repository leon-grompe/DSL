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
    abstract validate(sequence: Phase[], startIndex: number) : [boolean, number];
}

/**
 * Represents an elementary block in the behaviour protocol, which corresponds to a single phase.
 * Also allows the use of a wildcard phase 'Any' which can match any phase in the sequence.
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
        if (currentPhase?.name === this.phase || this.phase === 'Any'){
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
                console.log('Validation failed at block:', block, '| sequence phase was:', sequence[startIndex + updatedStartingPoint]);
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
        
        // First, enforce the minimum required matches
        for (let counter = 0; counter < this.min; counter++) {
            const [isValid, validatedIndex] = this.block.validate(sequence, startIndex + updatedStartingPoint);
            if (!isValid) {
                return [false, updatedStartingPoint];
            }
            updatedStartingPoint = validatedIndex;
        }
        
        // Then, optionally match more times up to max
        for (let counter = this.min; counter < this.max; counter++) {
            const [isValid, validatedIndex] = this.block.validate(sequence, startIndex + updatedStartingPoint);
            if (!isValid) {
                break; // Optional repetition failed — that's fine, we're done
            }
            updatedStartingPoint = validatedIndex;
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