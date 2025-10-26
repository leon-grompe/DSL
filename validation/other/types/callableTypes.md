# Validations from "callableTypes.ts"

callableTypeParameterMustNotHaveConstModifier 
    node: SdsCallableType
    'error', 'The const modifier is not applicable to parameters of callable types.'
    CODE_CALLABLE_TYPE_CONST_MODIFIER


callableTypeMustNotHaveOptionalParameters 
    node: SdsCallableType
    'error', 'A callable type must not have optional parameters.'
    CODE_CALLABLE_TYPE_NO_OPTIONAL_PARAMETERS


## Assessment
Definitely possible
    delete const modifier
    remove optional