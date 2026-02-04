// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title FeeMath
/// @notice Utilitare matematice pentru fee-uri si sume nete
/// @dev Librarie creata manual (cerinta optionala)
library FeeMath {
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Calculeaza fee-ul platformei
    function platformFee(uint256 amount, uint256 feeBps)
        internal
        pure
        returns (uint256)
    {
        return (amount * feeBps) / BPS_DENOMINATOR;
    }


    /// @notice Verifica validitatea unui fee exprimat in bps
    function isValidFee(uint256 feeBps)
        internal
        pure
        returns (bool)
    {
        return feeBps <= 1_000; // max 10%
    }
}
