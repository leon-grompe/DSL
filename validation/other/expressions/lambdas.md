# Validations from "lambdas.ts"

lambdaMustBeAssignedToTypedParameter 
    node: SdsLambda
    'error', 'A lambda must be assigned to a typed parameter.'
    CODE_LAMBDA_CONTEXT


lambdaParameterMustNotHaveConstModifier 
    node: SdsLambda
    'error', 'The const modifier is not applicable to parameters of lambdas.'
    CODE_LAMBDA_CONST_MODIFIER


## Assessment
Maybe possible?
    Unsure about type