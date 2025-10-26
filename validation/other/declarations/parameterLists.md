# Validations from "parameterLists.ts"

parameterListMustNotHaveRequiredParametersAfterOptionalParameters 
    node: SdsParameterList
    'error', 'After the first optional parameter all parameters must be optional.'
    CODE_PARAMETER_LIST_REQUIRED_AFTER_OPTIONAL


## Assessment
Should be possible.
Either swap places or remove optional keyword