# Validations from "types.ts"

typeMustBeUsedInCorrectContext 
    node: SdsType
    'error', 'Callable types must only be used for parameters.'
    CODE_TYPE_CONTEXT
    -
    'error', 'Union types must only be used for parameters of annotations, classes, and functions.'
    CODE_TYPE_CONTEXT


## Assessment
Seems Possible   