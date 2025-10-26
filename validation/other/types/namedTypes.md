# Validations from "namedTypes.ts"

namedTypeMustNotSetTypeParameterMultipleTimes 
    node: SdsNamedType
    'error', "The type parameter '${correspondingTypeParameter.name}' is already set."
    CODE_NAMED_TYPE_DUPLICATE_TYPE_PARAMETER


namedTypeTypeArgumentListMustNotHavePositionalArgumentsAfterNamedArguments 
    node: SdsNamedType
    'error', 'After the first named type argument all type arguments must be named.'
    CODE_NAMED_TYPE_POSITIONAL_AFTER_NAMED


namedTypeMustNotHaveTooManyTypeArguments 
    node: SdsNamedType
    'error', "Expected exactly ${minTypeArgumentCount} ${kind} but got ${actualTypeArgumentCount}."
    CODE_NAMED_TYPE_TOO_MANY_TYPE_ARGUMENTS
    -
    'error', "Expected between ${minTypeArgumentCount} and ${maxTypeArgumentCount} ${kind} but got ${actualTypeArgumentCount}."
    CODE_NAMED_TYPE_TOO_MANY_TYPE_ARGUMENTS


## Assessment
Probably possible. Need to look into named types.

