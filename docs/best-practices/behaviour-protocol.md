# Behaviour Protocol

The best practices in [Pipeline Structure](pipeline-structure.md) and [Avoiding common mistakes](common-errors.md) are
easy to state but also easy to get wrong, and the mistakes are usually *silent*. A pipeline that fits an imputer before
the split, or computes its final score on data it already tuned against, runs without error and reports great numbers.
The **behaviour protocol** turns these best practices into rules that Safe-DS checks while you create a pipeline. It is a
formal description of how a well-formed pipeline should be shaped; when your pipeline deviates from it, Safe-DS statically
reports a validation message that explains what is expected and why.

!!! info "Experimental"
    The behaviour protocol and its activity annotations are **experimental**. The set of phases, activities, and rules may change as the feature matures.

## How it works

Every relevant function in the Safe-DS standard library is annotated with one or more [activities](activities.md). An
activity describes a use case for this function. As you write a pipeline, Safe-DS reads these annotations to reconstruct
the sequence of activities your program performs, and matches that sequence against the protocol.

The protocol is expressed as a regular-expression-like structure over the ordered [phases](pipeline-structure.md): each
phase allows a set of activities, states whether it is required, how often it may repeat, and which data partition
(training, validation, or test) its activities may touch.

**Calls without an activity**

A call that carries no activity annotation is treated as a wildcard (`Any`) and matches in any phase, so custom or
un-annotated functions never break the protocol. Only annotated standard-library calls drive the checks.

When you create your own function or segment, you may also use the `@PipelineActivity([])` annotation to describe where
it should be used.

## What it checks

### 1. Phase order and essential phases

The activities must appear in [phase order](pipeline-structure.md#the-three-layers), and the essential phases
(**Data Acquisition**, **Data Partitioning**, **Feature Selection**, **Modeling**) must be present. A missing or
out-of-place activity produces a **protocol violation** which reads in the code as a warning.

If the pipeline ends before an essential phase is satisfied, the message says what to add:

```
The Pipeline ended before the required Phase 'DataPartitioning' is complete.
To satisfy the phase, use the following Activities 'DataSplitting' to split the data into at least training and test sets.
```

If an activity appears in the wrong place, the message names it and relates it to the phase you are stuck on:

```
The Activity 'Modeling - ModelCreation' is not allowed in current Phase 'DataPartitioning'.
This Activity is only allowed after completing the required 'DataPartitioning' Phase.
Use 'DataSplitting' during the current Phase to split the data into at least training and test sets.
```

### 2. Data-partition restrictions

After the split, some activities may only touch a specific partition. Safe-DS traces which partition each value flows
from, and a call on the wrong partition produces a **dataset mismatch** which reads as an error, since it usually means
data leakage. It comes with a quick-fix:

```
During Phase 'DataProcessing' the Activity 'PostSplitCleaning' should only be performed on 'Training'.
Change 'Test' to 'Training' to avoid data leakage.
```

The quickfix changes your selected dataset to the most specific placeholder available of the correct dataset.

### 3. Consistent preprocessing across partitions

Whatever transformations feed the model must be applied *identically* to every partition, otherwise the training and
held-out data are no longer comparable. Safe-DS checks, in order, that each transformer is:

- applied the **same number of times** on every partition (`fit` is training-only and excluded);
- applied in the **same order**;
- wired into the **same data flow** (its output feeds the same successors);
- passed the **same argument values**.

A deviation produces an inconsistent-preprocessing warning, for example:

```
Inconsistent preprocessing: 'transformTable (StandardScaler)' is applied once on 'Test' but not applied on 'Training'.
Fix: apply 'transformTable (StandardScaler)' the same number of times on every partition.
```

### 4. Test set usage

The test set (see [The three datasets](pipeline-structure.md#the-three-datasets)) exists for a single final estimate of
the model's performance on unseen data. Every statement in the Testing phase carries an informational reminder:

```
Testing should only be done once, as a final estimate of the model's performance on unseen data.
Use the validation set for hyperparameter optimization instead.
```

## See also

- [Pipeline Structure](pipeline-structure.md) — the phases and partition rules the protocol is built on.
- [Activities](activities.md) — the activity annotations that drive the checks.