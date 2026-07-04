import { ValidationError } from './protocolErrors.js';

/**
 * Represents the result of the behaviour protocol validation.
 * Carries information about what kind of error occured during validation.
 */
export class ValidationResult {
    public readonly isValid: boolean;
    public readonly validatedIndex: number;
    /** The single error of a failed result; undefined on success. */
    public readonly error?: ValidationError;

    private constructor(isValid: boolean, validatedIndex: number, error?: ValidationError) {
        this.isValid = isValid;
        this.validatedIndex = validatedIndex;
        this.error = error;
    }

    static success(validatedIndex: number): ValidationResult {
        return new ValidationResult(true, validatedIndex);
    }

    /** A failure carries exactly one error; the enclosing RepetitionBlock enriches it with the phase. */
    static failure(validatedIndex: number, error: ValidationError): ValidationResult {
        return new ValidationResult(false, validatedIndex, error);
    }

    generateValidationMessage(): ValidationMessage {
        const error = this.error;
        if (!error) {
            return { message: 'The pipeline does not follow the behaviour protocol.', severity: 'warning' };
        }
        // the phase travels on the error itself (attached by the enclosing RepetitionBlock), so the
        // error's own formatMessage can resolve it; '' is just a fallback for errors without a phase.
        return { message: error.formatMessage(), severity: error.severity };
    }
}

export interface ValidationMessage {
    message: string;
    severity: 'error' | 'warning' | 'info';
}
