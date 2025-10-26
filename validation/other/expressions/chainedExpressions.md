# Validations from "chainedExpressions.ts"

chainedExpressionsMustBeNullSafeIfReceiverIsNullable 
    node: SdsChainedExpression
    'error', 'The receiver can be null so a null-safe call must be used.'
    CODE_CHAINED_EXPRESSION_MISSING_NULL_SAFETY
    -
    'error', 'The receiver can be null so a null-safe indexed access must be used.'
    CODE_CHAINED_EXPRESSION_MISSING_NULL_SAFETY
    -
    'error', 'The receiver can be null so a null-safe member access must be used.'
    CODE_CHAINED_EXPRESSION_MISSING_NULL_SAFETY


## Assessment
Probably possible