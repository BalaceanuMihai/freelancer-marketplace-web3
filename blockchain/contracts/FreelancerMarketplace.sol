// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;
import { FeeMath } from "./libraries/FeeMath.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";


using FeeMath for uint256;


interface IEscrow {
    function deposit(uint256 jobId) external payable;
    function release(uint256 jobId, address payable freelancer) external;
    function jobDeposits(uint256 jobId) external view returns (uint256);
    function refund(uint256 jobId, address payable client) external;
}

contract FreelancerMarketplace is ReentrancyGuard{
    // 2% fee in basis points (bps). 10_000 bps = 100%
    uint256 public constant PLATFORM_FEE_BPS = 200;

    IEscrow public escrow;
    address payable public feeRecipient;

    uint256 public nextJobId;

    struct Job {
        uint256 id;
        address client;
        address freelancer;
        string description;
        uint256 price;      // net amount (after fee) that goes to freelancer
        bool completed;
        bool paid;
    }

    mapping(uint256 => Job) public jobs;

    event JobCreated(uint256 indexed jobId, address indexed client, string description, uint256 netPrice);
    event PlatformFeePaid(uint256 indexed jobId, address indexed recipient, uint256 fee);
    event FreelancerAssigned(uint256 indexed jobId, address indexed freelancer);
    event JobCompleted(uint256 indexed jobId);
    event PaymentReleased(uint256 indexed jobId, address indexed freelancer, uint256 amount);
    event JobCancelled(uint256 indexed jobId, address indexed client, uint256 refundedAmount);

    modifier onlyClient(uint256 jobId) {
        require(jobs[jobId].client == msg.sender, "Not client");
        _;
    }

    modifier onlyFreelancer(uint256 jobId) {
        require(jobs[jobId].freelancer == msg.sender, "Not freelancer");
        _;
    }

    constructor(address escrowAddress, address payable _feeRecipient) {
        require(FeeMath.isValidFee(PLATFORM_FEE_BPS), "Invalid fee bps");
        require(escrowAddress != address(0), "Invalid escrow");
        require(_feeRecipient != address(0), "Invalid fee recipient");

        escrow = IEscrow(escrowAddress);
        feeRecipient = _feeRecipient;
        nextJobId = 0;
    }

    // PURE: fee calculation does not read or modify blockchain state
    function calculatePlatformFee(uint256 amount) public pure returns (uint256) {
        return (amount * PLATFORM_FEE_BPS) / 10_000;
    }

    function createJob(string calldata description) external payable {
        require(msg.value > 0, "Price must be > 0");
        require(bytes(description).length > 0, "Description required");

        uint256 fee = calculatePlatformFee(msg.value);
        uint256 netAmount = msg.value - fee;
        require(netAmount > 0, "Net must be > 0");

        uint256 jobId = nextJobId++;
        jobs[jobId] = Job({
            id: jobId,
            client: msg.sender,
            freelancer: address(0),
            description: description,
            price: netAmount,
            completed: false,
            paid: false
        });

        // Pay platform fee
        if (fee > 0) {
            (bool okFee, ) = feeRecipient.call{value: fee}("");
            require(okFee, "Fee transfer failed");
            emit PlatformFeePaid(jobId, feeRecipient, fee);
        }

        // Deposit net amount to escrow
        escrow.deposit{value: netAmount}(jobId);

        emit JobCreated(jobId, msg.sender, description, netAmount);
    }

    function cancelJob(uint256 jobId) external onlyClient(jobId) {
        Job storage j = jobs[jobId];

        require(j.freelancer == address(0), "Job already assigned");
        require(!j.completed, "Job already completed");
        require(!j.paid, "Job already paid");

        uint256 refunded = escrow.jobDeposits(jobId);
        require(refunded > 0, "Nothing to refund");

        // refund from escrow back to client
        escrow.refund(jobId, payable(j.client));

        emit JobCancelled(jobId, j.client, refunded);
    }

    function applyForJob(uint256 jobId) external {
        Job storage j = jobs[jobId];

        require(j.client != address(0), "Job does not exist");
        require(j.freelancer == address(0), "Already assigned");
        require(!j.completed, "Already completed");
        require(!j.paid, "Already paid");

        j.freelancer = msg.sender;

        emit FreelancerAssigned(jobId, msg.sender);
    }

    function markCompleted(uint256 jobId) external onlyFreelancer(jobId) {
        Job storage j = jobs[jobId];

        require(!j.completed, "Already completed");
        require(!j.paid, "Already paid");

        j.completed = true;

        emit JobCompleted(jobId);
    }

    function releasePayment(uint256 jobId) external onlyClient(jobId) {
        Job storage j = jobs[jobId];

        require(!j.paid, "Already paid");
        require(j.completed, "Job not completed");
        require(j.freelancer != address(0), "No freelancer assigned");
        require(escrow.jobDeposits(jobId) > 0, "No funds to release");

        j.paid = true;

        escrow.release(jobId, payable(j.freelancer));

        emit PaymentReleased(jobId, j.freelancer, j.price);
    }

    function getJobSummary(uint256 jobId) external view
        returns (
            address client,
            address freelancer,
            bool completed,
            uint256 totalAmount,
            uint256 escrowedAmount,
            bool paymentReleased
        )
    {
        Job storage j = jobs[jobId];

        client = j.client;
        freelancer = j.freelancer;
        completed = j.completed;
        totalAmount = j.price;

        escrowedAmount = escrow.jobDeposits(jobId);
        paymentReleased = escrowedAmount == 0 && j.completed;
    }

}
