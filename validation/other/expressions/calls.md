# Validations from "calls.ts"

callArgumentMustBeConstantIfParameterIsConstant 
    node: SdsCall
    'error', 'Values assigned to constant parameters must be constant.'
    CODE_CALL_CONSTANT_ARGUMENT


callMustNotBeRecursive 
    node: SdsCall
    'error', 'Call leads to infinite recursion.'
    CODE_CALL_INFINITE_RECURSION


## Assessment
Unsure