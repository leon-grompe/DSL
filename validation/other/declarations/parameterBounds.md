# Validations from "parameterBounds.ts"

callArgumentMustRespectParameterBounds 
    node: SdsCall
    'error', "The value of '${parameterName}' must be ${relation} ${rightOperand.toString()} but was ${leftOperand.toString()}."
    CODE_PARAMETER_BOUND_INVALID_VALUE


parameterBoundParameterMustBeConstFloatOrInt 
    node: SdsParameterBound
    'error', "Only 'Float' and 'Int' parameters can have bounds."
    CODE_PARAMETER_BOUND_PARAMETER
    -
    'error', 'Only constant parameters can have bounds.'
    CODE_PARAMETER_BOUND_PARAMETER


parameterBoundRightOperandMustEvaluateToFloatConstantOrIntConstant 
    node: SdsParameterBound
    'error', 'The right operand of a parameter bound must evaluate to a float or int constant.'
    CODE_PARAMETER_BOUND_RIGHT_OPERAND


## Assessment
Probably most interesting thus far