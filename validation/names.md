# Validations from "names.ts"

## Codegen prefix
nameMustNotStartWithCodegenPrefix
    node: SdsDeclaration
    'error', 'Names of declarations must not start with '${CODEGEN_PREFIX}'. This is reserved for code generation.'
    CODE_NAME_CODEGEN_PREFIX


## Core declaration
nameMustNotOccurOnCoreDeclaration
    node: SdsDeclaration
    'error', 'Names of core declarations must not be used for own declarations.'
    CODE_NAME_CORE_DECLARATION


## Casing
nameShouldHaveCorrectCasing 
    node: SdsDeclaration
    'warning', 'All segments of the qualified name of a package should be lowerCamelCase.'
    CODE_NAME_CASING


nameShouldBeLowerCamelCase 
    node: SdsAttribute | SdsBlockLambdaResult | SdsFunction | SdsParameter | SdsPipeline | SdsPlaceholder | SdsResult | SdsSegment
    'warning', 'Names of ${nodeName} should be lowerCamelCase.'
    CODE_NAME_CASING


nameShouldBeLowerCamelCaseWithOptionalLeadingUnderscore 
    node: SdsPlaceholder
    'warning', 'Names of ${nodeName} should be lowerCamelCase with an optional leading underscore.'
    CODE_NAME_CASING


nameShouldBeUpperCamelCase
    node: SdsAnnotation | SdsClass | SdsEnum | SdsEnumVariant | SdsTypeAlias | SdsTypeParameter
    'warning', 'Names of ${nodeName} should be UpperCamelCase.'
    CODE_NAME_CASING


## Uniqueness
annotationMustContainUniqueNames 
    node: SdsAnnotation

blockLambdaMustContainUniqueNames 
    node: SdsBlockLambda

callableTypeMustContainUniqueNames 
    node: SdsCallableType

classMustContainUniqueNames 
    node: SdsClass

staticClassMemberNamesMustNotCollideWithInheritedMembers 
    node: SdsClass

enumMustContainUniqueNames 
    node: SdsEnum

enumVariantMustContainUniqueNames 
    node: SdsEnumVariant

expressionLambdaMustContainUniqueNames 
    node: SdsExpressionLambda

functionMustContainUniqueNames
    node: SdsFunction

moduleMemberMustHaveNameThatIsUniqueInPackage 
    node: SdsModule
    'error', `Multiple ${kind} have the name '${member.name}'
    CODE_NAME_DUPLICATE

moduleMustContainUniqueNames 
    node: SdsModule
    'error', "A declaration with name '${importedDeclarationName(duplicate)}' was imported already."
    CODE_NAME_DUPLICATE
    -
    'error', "A declaration with name '${importedDeclarationName(duplicate)}' was imported already."
    CODE_NAME_DUPLICATE

pipelineMustContainUniqueNames 
    node: SdsPipeline

segmentMustContainUniqueNames
    node: SdsSegment


namesMustBeUnique 
    CODE_NAME_DUPLICATE


## Assessment
- "Codegen" and "Core" probably possible
- "Casing" definitely possible and useful
- "Uniqueness" not really possible, since new name must be chosen by user
