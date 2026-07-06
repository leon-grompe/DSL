# Activities

Every function in the integrated API that matters to the behaviour protocol is tagged with one or more **activities**
via the `@PipelineActivity` annotation.

## Naming

Activity names follow the pattern `PhaseQType`, where the letter `Q` separates the phase from the activity type — for
example, `DataAcquisitionQDataLoading` is the *data loading* activity of the *Data Acquisition* phase.

The same activity *type* can appear in several phases. *Exploration*, for instance, exists both before the split (as
`DataPreparationQExploration`) and after it (as `DataProcessingQExploration`). The table below lists each activity type
once, together with the phases it appears in and what it does.

!!! info "Experimental"
    Activities are **experimental** and defined in the `safeds.lang` builtin module. The exact set may change.

## Activity reference

| Activity | Phases | Description |
|----------|--------|-------------|
| `DataLoading` | Data Acquisition | Import data from external files. |
| `DatatypeConstruction` | Data Acquisition, Feature Engineering | Build data by hand (e.g. a `Table` or `Column`). |
| `Utilities` | Data Acquisition, Data Preparation, Data Processing, Feature Engineering | Helper operations for many different contexts. |
| `Exploration` | Data Preparation, Data Processing | Exploratory data analysis (statistics, plots, …). |
| `PreSplitCleaning` | Data Preparation | Deterministic pre-split cleaning (row removal). |
| `SchemaModification` | Data Preparation, Data Processing, Feature Engineering, Feature Selection | Change the column structure (rename/add/remove, join). |
| `DataSplitting` | Data Partitioning | Split the dataset into training, test, and (optionally) validation sets. |
| `PostSplitCleaning` | Data Processing | Distribution-based cleaning (row removal). |
| `Augmentation` | Data Processing | Grow or vary the training data. |
| `DataTransformation` | Data Processing | Transform existing values with transformers (scale, impute). |
| `Engineering` | Feature Engineering | Derive or add new feature columns. |
| `FeatureTransformation` | Feature Engineering | Create new feature representations with transformers (encode, discretize). |
| `TabularDatasetConversion` | Feature Selection | Convert a table into a tabular dataset and choose target and features. |
| `ModelCreation` | Modeling | Construct a model or network layers. |
| `ModelFitting` | Training | Train the model on the training set. |
| `Prediction` | Evaluation, Testing | Run the model on held-out data and predict the target column. |
| `MetricCalculation` | Evaluation, Testing | Compute numeric performance scores. |
| `PostProcessing` | Interpretation | Post-process features to derive information (inverse-transform feature columns). |
| `Visualization` | Interpretation | Plot the model. |

**Augmentation**

The `Augmentation` activity currently has no functions attached to it, since there are no specific augmentation
operations in the standard library yet. It is reserved for future use.

## Data-partition rules

After splitting the data, some activities should only ever touch a specific partition. Applying them to the wrong one
risks data leakage.

| Phase | Activity | Allowed partition |
|-------|----------|-------------------|
| Data Processing | Exploration, post-split cleaning, augmentation | Training only |
| Data Processing | Data transformation, schema modification, utilities | Any partition |
| Evaluation | Prediction, metric calculation | Validation only |
| Testing | Prediction, metric calculation | Test only |

The reason exploration, cleaning, and augmentation are training-only is the same as above: they are decisions you make by
looking at the data, and you must not make them by looking at data the model will later be judged on.

**Do not tune on the test set**

Evaluation runs on only the **validation** set. That is the set you are allowed to look at repeatedly while tuning
hyperparameters. The **test** set is used *once*, in the Testing phase, to estimate how the model generalizes to unseen
data. The moment you make a modeling decision based on the test score, that score stops being an honest estimate of
generality.

## See also

- [API by Activity](../api/by-activity.md) — a lookup of every API operation grouped by the activity it performs.
- [Pipeline Structure](pipeline-structure.md) — how these activities are ordered into phases and layers.
