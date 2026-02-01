// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IEscrow {
    function deposit(uint256 jobId) external payable;
    function release(uint256 jobId, address payable freelancer) external;
}

contract FreelancerMarketplace {
    struct Job {
        uint256 id;
        address client;
        string description;
        uint256 price;
        address freelancer;
        bool completed;
        bool paid;
    }

    mapping(uint256 => Job) public jobs;
    uint256 public nextJobId;
    IEscrow public escrow;

    event JobCreated(uint256 jobId, address client, uint256 price);
    event FreelancerAssigned(uint256 jobId, address freelancer);
    event JobCompleted(uint256 jobId);
    event PaymentReleased(uint256 jobId, address freelancer, uint256 amount);

    constructor(address escrowAddress) {
        escrow = IEscrow(escrowAddress);
    }

    modifier onlyClient(uint256 jobId) {
        require(jobs[jobId].client == msg.sender, "Not client");
        _;
    }

    modifier onlyFreelancer(uint256 jobId) {
        require(jobs[jobId].freelancer == msg.sender, "Not freelancer");
        _;
    }

    function createJob(string calldata description) external payable {
        uint256 jobId = nextJobId++;
        jobs[jobId] = Job(
            jobId,
            msg.sender,
            description,
            msg.value,
            address(0),
            false,
            false
        );
        escrow.deposit{value: msg.value}(jobId);
        emit JobCreated(jobId, msg.sender, msg.value);
    }

    function applyForJob(uint256 jobId) external {
        require(jobs[jobId].freelancer == address(0), "Already taken");
        jobs[jobId].freelancer = msg.sender;
        emit FreelancerAssigned(jobId, msg.sender);
    }

    function markCompleted(uint256 jobId) external onlyFreelancer(jobId) {
        jobs[jobId].completed = true;
        emit JobCompleted(jobId);
    }

    function releasePayment(uint256 jobId) external onlyClient(jobId) {
        Job storage j = jobs[jobId];
        require(j.completed, "Not completed");
        j.paid = true;
        escrow.release(jobId, payable(j.freelancer));
        emit PaymentReleased(jobId, j.freelancer, j.price);
    }
}
