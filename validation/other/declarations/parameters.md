# Validations from "parameters.ts"

constantParameterMustHaveConstantDefaultValue 
    node: SdsParameter
    'error', "Default values of ${kind} parameters must be constant."
    CODE_PARAMETER_CONSTANT_DEFAULT_VALUE


constantParameterMustHaveTypeThatCanBeEvaluatedToConstant 
    node: SdsParameter
    'error', "${kind} parameter cannot have type '${type.toString()}'."
    CODE_PARAMETER_CONSTANT_TYPE


## Assessment
Unsure