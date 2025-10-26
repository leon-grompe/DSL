# Validations from "argumentLists.ts"

argumentListMustNotHavePositionalArgumentsAfterNamedArguments 
    node: SdsArgumentList
    'error', 'After the first named argument all arguments must be named.'
    CODE_ARGUMENT_LIST_POSITIONAL_AFTER_NAMED


argumentListMustNotHaveTooManyArguments 
    node: SdsAbstractCall
    'error', "Expected exactly ${minArgumentCount} ${kind} but got ${actualArgumentCount}."
    CODE_ARGUMENT_LIST_TOO_MANY_ARGUMENTS
    -
    'error', "Expected between ${minArgumentCount} and ${maxArgumentCount} ${kind} but got ${actualArgumentCount}."
    CODE_ARGUMENT_LIST_TOO_MANY_ARGUMENTS


argumentListMustNotSetParameterMultipleTimes 
    node: SdsArgumentList
    'error', "The parameter '${correspondingParameter.name}' is already set."
    CODE_ARGUMENT_LIST_DUPLICATE_PARAMETER


argumentListMustSetAllRequiredParameters 
    node: SdsAbstractCall
    'error', "The ${kind} ${missingParametersString} must be set here."
    CODE_ARGUMENT_LIST_MISSING_REQUIRED_PARAMETER


## Assessment
Definitely possible and helpful