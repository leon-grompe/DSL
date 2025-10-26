# Validations from "memberAccesses.ts"

memberAccessOfEnumVariantMustNotLackInstantiation 
    node: SdsMemberAccess
    'error', "The enum variant '${declaration.name}' has parameters, so an argument list must be added."
    CODE_MEMBER_ACCESS_MISSING_ENUM_VARIANT_INSTANTIATION


## Assessment
Probably possible by adding argument list