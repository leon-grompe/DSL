# Validations from "purity.ts"

functionPurityMustBeSpecified 
    node: SdsFunction
    'error', "'@Impure' and '@Pure' are mutually exclusive."
    CODE_PURITY_IMPURE_AND_PURE
    -
    'error', "The purity of a function must be specified. Call the annotation '@Pure' or '@Impure'."
    CODE_PURITY_MUST_BE_SPECIFIED
    -
    'error', 'At least one impurity reason must be specified.'
    CODE_PURITY_MUST_BE_SPECIFIED


impurityReasonsOfOverridingMethodMustBeSubsetOfOverriddenMethod
    node: SdsFunction
    'error', 'The impurity reasons of an overriding function must be a subset of the impurity reasons of the overridden function.'
    CODE_PURITY_IMPURITY_REASONS_OF_OVERRIDING_METHOD


impurityReasonParameterNameMustBelongToParameterOfCorrectType 
    node: SdsFunction
    'error', "The parameter '${evaluatedParameterName.value}' does not exist."
    CODE_PURITY_INVALID_PARAMETER_NAME
    -
    'error', "The parameter '${evaluatedParameterName.value}' must have a callable type."
    CODE_PURITY_POTENTIALLY_IMPURE_PARAMETER_NOT_CALLABLE


impurityReasonShouldNotBeSetMultipleTimes 
    node: SdsFunction
    'warning', "The impurity reason '${stringifiedReason}' was set already."
    CODE_PURITY_DUPLICATE_IMPURITY_REASON


pureParameterDefaultValueMustBePure 
    node: SdsParameter
    'error', 'Cannot pass an impure callable to a pure parameter.'
    CODE_PURITY_PURE_PARAMETER_SET_TO_IMPURE_CALLABLE


callArgumentAssignedToPureParameterMustBePure
    node: SdsCall
    'error', 'Cannot pass an impure callable to a pure parameter.'
    CODE_PURITY_PURE_PARAMETER_SET_TO_IMPURE_CALLABLE


## Assessment
Unsure