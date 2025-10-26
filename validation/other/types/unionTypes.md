# Validations from "types.ts"

unionTypeMustHaveTypes 
    node: SdsUnionType
    'error', 'A union type must have at least one type.'
    CODE_UNION_TYPE_MISSING_TYPES


unionTypeShouldNotHaveDuplicateTypes 
    node: SdsUnionType
    'warning', "The type '${type.toString()}' was already listed."
    CODE_UNION_TYPE_DUPLICATE_TYPE


## Assessment
Unsure