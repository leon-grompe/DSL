import { Phase } from './model.js'

export type ValidationError = 
    | {type: 'sequence-block-failed'; name?: string }     
    
    | {type: 'elem-block-oob' }
    | {type: 'elem-block-phase-mismatch'; expected: Phase; found: Phase }
    
    | {type: 'alternative-block-no-match'; alternatives: Phase[]}
    | {type: 'or-block-no-match'; alternatives: Phase[]}
    | {type: 'xor-block-multiple-matches'; alternatives: Phase[]}
    
    | {type: 'repetition-block-minimum-not-met'; min: number; actual: number; name?:string }


export class ValidationResult {
    public readonly isValid: boolean;
    public readonly validatedIndex: number;
    public readonly error?: ValidationError;
    public readonly baseError?: ValidationResult;
    
    private constructor (isValid: boolean, validatedIndex: number, error?: ValidationError, baseError?: ValidationResult, innerResults?: ValidationResult[]){
        this.isValid = isValid;
        this.validatedIndex = validatedIndex;
        this.baseError = baseError;
        this.error = error;
    }

    static success(
        validatedIndex: number, 
        baseError?: ValidationResult
    ): ValidationResult {
        return new ValidationResult(true, validatedIndex, undefined, baseError);
    }
    
    static failure(
        validatedIndex: number, 
        error?: ValidationError, 
        baseError?: ValidationResult, 
    ): ValidationResult {
        return new ValidationResult(false, validatedIndex, error, baseError);
    }
}
