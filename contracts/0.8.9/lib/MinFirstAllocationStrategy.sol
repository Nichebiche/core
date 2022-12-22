// SPDX-FileCopyrightText: 2022 Lido <info@lido.fi>
// SPDX-License-Identifier: GPL-3.0

/* See contracts/COMPILERS.md */
pragma solidity 0.8.9;

import {Math} from "./Math.sol";

library MinFirstAllocationStrategy {
    function allocate(
        uint256[] memory allocations,
        uint256[] memory capacities,
        uint256 maxAllocationSize
    ) internal pure {
        uint256 allocated = 0;
        uint256 allocatedTotal = 0;
        do {
            allocated = allocateToBestCandidate(allocations, capacities, maxAllocationSize);
        } while (allocatedTotal < maxAllocationSize && allocated > 0);
    }

    function allocateToBestCandidate(
        uint256[] memory allocations,
        uint256[] memory capacities,
        uint256 maxAllocationSize
    ) internal pure returns (uint256 allocated) {
        uint256 bestCandidateIndex = type(uint256).max;
        uint256 bestCandidateAllocation = type(uint256).max;
        uint256 bestCandidatesCount = 0;

        for (uint256 i = 0; i < allocations.length; ++i) {
            if (allocations[i] >= capacities[i]) {
                continue;
            } else if (bestCandidateAllocation > allocations[i]) {
                bestCandidateIndex = i;
                bestCandidatesCount = 1;
                bestCandidateAllocation = allocations[i];
            } else if (bestCandidateAllocation == allocations[i]) {
                bestCandidatesCount += 1;
            }
        }

        if (bestCandidatesCount == 0 || maxAllocationSize == 0) {
            return 0;
        }

        // bound the allocation by the smallest larger allocation than the found "best" one
        uint256 allocationSizeUpperBound = type(uint256).max;
        for (uint256 i = 0; i < allocations.length; ++i) {
            if (allocations[i] > bestCandidateAllocation && allocations[i] < allocationSizeUpperBound) {
                allocationSizeUpperBound = allocations[i];
            }
        }

        // allocate at least one item per iteration
        uint256 allocationSize = Math.max(maxAllocationSize / bestCandidatesCount, 1);

        allocated = Math.min(
            allocationSize,
            Math.min(allocationSizeUpperBound, capacities[bestCandidateIndex]) - bestCandidateAllocation
        );
        allocations[bestCandidateIndex] += allocated;
    }
}
