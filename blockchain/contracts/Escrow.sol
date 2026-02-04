// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract Escrow {
    address public marketplace;

    // jobId => amount locked
    mapping(uint256 => uint256) public jobDeposits;

    event Deposited(uint256 indexed jobId, uint256 amount);
    event Released(uint256 indexed jobId, address indexed freelancer, uint256 amount);
    event MarketplaceSet(address marketplace);
    event Refunded(uint256 indexed jobId, address indexed client, uint256 amount);

    modifier onlyMarketplace() {
        require(msg.sender == marketplace, "Only marketplace");
        _;
    }

    // Set once, after Marketplace is deployed
    function setMarketplace(address _marketplace) external {
        require(marketplace == address(0), "Marketplace already set");
        require(_marketplace != address(0), "Invalid address");
        marketplace = _marketplace;
        emit MarketplaceSet(_marketplace);
    }

    function deposit(uint256 jobId) external payable onlyMarketplace {
        require(msg.value > 0, "No ETH sent");
        jobDeposits[jobId] += msg.value;
        emit Deposited(jobId, msg.value);
    }

    function release(uint256 jobId, address payable freelancer) external onlyMarketplace {
        uint256 amount = jobDeposits[jobId];
        require(amount > 0, "Nothing to release");
        require(freelancer != address(0), "Invalid freelancer");

        // effects
        jobDeposits[jobId] = 0;

        // interaction
        (bool ok, ) = freelancer.call{value: amount}("");
        require(ok, "ETH transfer failed");

        emit Released(jobId, freelancer, amount);
    }

    function refund(uint256 jobId, address payable client) external onlyMarketplace {
        uint256 amount = jobDeposits[jobId];
        require(amount > 0, "No funds to refund");

        // effects
        jobDeposits[jobId] = 0;

        // interaction
        (bool ok, ) = client.call{value: amount}("");
        require(ok, "Refund transfer failed");

        emit Refunded(jobId, client, amount);
    }

}
