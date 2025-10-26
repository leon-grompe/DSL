# Validations from "literalTypes.ts"

literalTypeMustHaveLiterals 
    node: SdsLiteralType
    'error', 'A literal type must have at least one literal.'
    CODE_LITERAL_TYPE_MISSING_LITERALS


literalTypeMustNotContainListLiteral 
    node: SdsLiteralType
    'error', 'Literal types must not contain list literals.'
    CODE_LITERAL_TYPE_LIST_LITERAL


literalTypeMustNotContainMapLiteral 
    node: SdsLiteralType
    'error', 'Literal types must not contain map literals.'
    CODE_LITERAL_TYPE_MAP_LITERAL


literalTypeShouldNotHaveDuplicateLiteral 
    node: SdsLiteralType
    'warning', "The literal ${constant.toString()} was already listed."
    CODE_LITERAL_TYPE_DUPLICATE_LITERAL


## Assessment
Probably possible. Need to look into literal types
