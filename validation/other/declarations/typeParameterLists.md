# Validations from "typeParameterLists.ts"

typeParameterListMustNotHaveRequiredTypeParametersAfterOptionalTypeParameters 
    node: SdsTypeParameterList
    'error', 'After the first optional type parameter all type parameters must be optional.'
    CODE_TYPE_PARAMETER_LIST_REQUIRED_AFTER_OPTIONAL


## Assessment
Possible. Similar to CODE_ARGUMENT_POSITIONAL?