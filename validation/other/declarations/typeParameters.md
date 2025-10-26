# Validations from "typeParameter.ts"

typeParameterMustHaveSufficientContext 
    node: SdsTypeParameter
    'error', 'Insufficient context to infer this type parameter.'
    CODE_TYPE_PARAMETER_INSUFFICIENT_CONTEXT


typeParameterUpperBoundMustNotBeUnknown 
    node: SdsTypeParameter
    'error', 'The upper bound of a type parameter must not have an unknown type.'
    CODE_TYPE_PARAMETER_UPPER_BOUND


typeParameterMustBeUsedInCorrectPosition
    node: SdsTypeParameter
    'error', 'This type parameter of a containing class cannot be used here.'
    CODE_TYPE_PARAMETER_USAGE
    -
    'error', "A contravariant type parameter cannot be used in ${position} position."
    CODE_TYPE_PARAMETER_USAGE
    -
    'error', "A covariant type parameter cannot be used in ${position} position."
    CODE_TYPE_PARAMETER_USAGE


typeParameterMustOnlyBeVariantOnClass 
    node: SdsTypeParameter
    'error', 'Only type parameters of classes can be variant.'
    CODE_TYPE_PARAMETER_VARIANCE


## Assessment
Partially possible