# Validations from "experimentalLanguageFeatures.ts"

constraintListsShouldBeUsedWithCaution 
    node: SdsConstraintList
    'warning', 'Constraint lists & constraints are experimental and may change without prior notice.'
    CODE_EXPERIMENTAL_LANGUAGE_FEATURE


literalTypesShouldBeUsedWithCaution
    node: SdsLiteralType
    'warning', 'Literal types are experimental and may change without prior notice.'
    CODE_EXPERIMENTAL_LANGUAGE_FEATURE


unionTypesShouldBeUsedWithCaution 
    node: SdsUnionType
    'warning', 'Union types are experimental and may change without prior notice.'
    CODE_EXPERIMENTAL_LANGUAGE_FEATURE


## Assessment
Not relevant, since Quickfixes cannot be implemented for these warnings