// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract Escrow {
    address public marketplace;
    mapping(uint256 => uint256) public deposits;

    event Deposited(uint256 indexed jobId, uint256 amount);
    event Released(uint256 indexed jobId, address indexed freelancer, uint256 amount);

    modifier onlyMarketplace() {
        require(msg.sender == marketplace, "Only marketplace");
        _;
    }

    constructor() {
        marketplace = msg.sender;
    }

    function setMarketplace(address _marketplace) external {
        require(msg.sender == marketplace, "Only current marketplace can set");
        marketplace = _marketplace;
    }

    function deposit(uint256 jobId) external payable onlyMarketplace {
        require(msg.value > 0, "No ETH sent");
        deposits[jobId] = msg.value;
        emit Deposited(jobId, msg.value);
    }

    function release(uint256 jobId, address payable freelancer) external onlyMarketplace {
        uint256 amount = deposits[jobId];
        deposits[jobId] = 0;
        (bool ok, ) = freelancer.call{value: amount}("");
        require(ok, "Transfer failed");
        emit Released(jobId, freelancer, amount);
    }

    function getDeposit(uint256 jobId) external view returns (uint256) {
        return deposits[jobId];
    }
}
