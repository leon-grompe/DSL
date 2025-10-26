# Validations from "indexedAccess.ts"

indexedAccessIndexMustBeValid 
    node: SdsIndexedAccess
    'error', "Map key '${indexValue}' does not exist."
    CODE_INDEXED_ACCESS_INVALID_INDEX
    -
    'error', "List index '${indexValue}' is out of bounds."
    CODE_INDEXED_ACCESS_INVALID_INDEX
    -
    'error', "List index '${indexValue}' is out of bounds."
    CODE_INDEXED_ACCESS_INVALID_INDEX


## Assessment
Probably possible. Set list index to max index