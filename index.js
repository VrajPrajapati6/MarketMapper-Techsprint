require("dotenv").config();

const express = require("express");
const app = express();
const mongoose = require("mongoose");
const path = require("path");
const User = require("./models/User.js");
const Report = require("./models/Report.js");
const Post = require("./models/Post.js");
const Business = require("./models/Business.js");
const Message = require("./models/Message.js");
const Conversation = require("./models/Conversation.js");
const Agreement = require("./models/Agreement.js");

const { GoogleGenerativeAI } = require("@google/generative-ai");
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

const expressError = require("./utils/errorHandler.js");
const isLoggedIn = require("./utils/isLoggedIn.js");
const wrapAsync = require("./utils/wrapAsync.js");
const saveUrl = require("./utils/saveUrl.js");

const upload = require("./multer");

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.use(express.static(path.join(__dirname, "public")));

const ejsMate = require("ejs-mate");
app.engine("ejs", ejsMate);

const session = require("express-session");
const MongoStore = require("connect-mongo");
const passport = require("passport");

const methodOverride = require("method-override");
app.use(methodOverride("_method"));

const store = MongoStore.create({
  mongoUrl: process.env.DATABASE_LINK,
  secret: process.env.SECRET,
  touchAfter: 24 * 3600,
});

app.use(
  session({
    store,
    secret: process.env.SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
      expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
      maxAge: 7 * 24 * 60 * 60 * 1000,
      httpOnly: true,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());
const flash = require("connect-flash");
app.use(flash());
require("./config/passport.js");

mongoose
  .connect(process.env.DATABASE_LINK)
  .then(() => console.log("MongoDB Connected!"))
  .catch((err) => console.log("MongoDB Error:", err));

app.listen(8080, () => {
  console.log("Server running on http://localhost:8080");
});

app.get("/", (req, res) => {
  if (req.isAuthenticated()) return res.redirect("/dashboard");
  res.render("landing", { title: "Welcome", link: "landing" });
});

app.use(async (req, res, next) => {
  if (req.isAuthenticated()) {
    try {
      const fullUser = await User.findById(req.user._id)
        .populate("pendingRequests", "username image")
        .populate("sentRequests", "username image")
        .populate("connections", "username image");

      res.locals.currUser = fullUser;
    } catch (err) {
      console.error("Auth Middleware Error:", err);
      res.locals.currUser = req.user;
    }
  } else {
    res.locals.currUser = null;
  }
  res.locals.auth = req.isAuthenticated();
  res.locals.success = req.flash("success");
  res.locals.error = req.flash("error");
  next();
});

/////updated dashboard route////
app.get(
  "/dashboard",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    try {
      // 1. Fetch reports for the Project Repository section
      const allReports = await Report.find({ author: req.user._id }).sort({
        createdAt: -1,
      });

      // 2. Fetch collaborations (contracts) for the new Hub section
      const contracts = await Agreement.find({
        $or: [{ sender: req.user._id }, { receiver: req.user._id }],
      }).sort({ createdAt: -1 });

      // --- 🟢 NEW: DYNAMIC REPUTATION SCORING LOGIC ---
      // Formula: Base(25) + Reports(5pts each) + Contracts(10pts each)
      const reportWeight = allReports.length * 5;
      const contractWeight = contracts.length * 10;
      let calculatedScore = 25 + reportWeight + contractWeight;

      // Ensure the score doesn't exceed 99 (Premium Elite cap)
      if (calculatedScore > 99) calculatedScore = 99;

      res.render("home", {
        title: "Dashboard",
        reports: allReports,
        currUser: req.user,
        contracts: contracts,
        score: calculatedScore, // 👈 Passing the dynamic score to the UI
        count: allReports.length,
        link: "dashboard",
      });
    } catch (err) {
      console.error("Dashboard Error:", err);
      res.render("home", {
        title: "Dashboard",
        reports: [],
        contracts: [],
        score: 25, // Default for errors
        count: 0,
        link: "dashboard",
        currUser: req.user,
      });
    }
  })
);

const cloudinary = require("./cloudinary");

app.get("/analysis", isLoggedIn, (req, res) => {
  res.render("analysis", { title: "Start Analysis", link: "analysis" });
});

app.post("/analysis/loading", isLoggedIn, (req, res) => {
  const { query } = req.body;
  if (!query) {
    req.flash("error", "Please enter valid query!");
    return res.redirect("/analysis");
  }
  res.render("loading", {
    query: query,
    title: "Neural Processing",
    link: "analysis",
    isRerun: "false",
  });
});

app.post(
  "/result",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { query, isRerun } = req.body;

    if (!query) {
      req.flash("error", "Please enter a valid business idea.");
      return res.redirect("/analysis");
    }

    if (isRerun !== "true") {
      const newReport = new Report({
        title: query,
        author: req.user._id,
        location: query.split(" ").pop() || "Ahmedabad",
      });
      await newReport.save();
    }

    const model = genAI.getGenerativeModel({ model: "gemini-3-flash-preview" });

    const prompt = `
    Act as an expert Business Consultant and Market Analyst.
    The user wants to open: "${query}".
    SIMULATE a complete market analysis.
    RETURN JSON ONLY. NO MARKDOWN.
    Strictly follow this structure:
    {
      "market_score": (Integer 0-100),
      "competition_level": "Low" | "Medium" | "High",
      "total_competitors_count": 10,
      "average_market_rating": 4.1,
      "center_coords": { "lat": 23.0225, "lng": 72.5714 },
      "competitors": [
          { "name": "Name", "rating": 4.5, "lat": 23.022, "lng": 72.571 }
      ],
      "alternative_locations": [
          { "area": "Area Name", "reason": "Why this area is good" }
      ],
      "gap_analysis": "Explanation.",
      "swot": {
        "strengths": [".."],
        "weaknesses": [".."],
        "opportunities": [".."],
        "threats": [".."]
      },
      "suggested_names": ["Name 1", "Name 2"]
    }
    `;

    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      let text = response.text();

      text = text
        .replace(/```json/g, "")
        .replace(/```/g, "")
        .trim();

      const analysisData = JSON.parse(text);

      res.render("result", {
        title: "Analysis Result",
        link: "result",
        data: analysisData,
        query: query,
      });
    } catch (e) {
      console.error("Gemini Error:", e);
      req.flash("error", "AI Analysis failed. Please try again.");
      res.redirect("/analysis");
    }
  })
);

app.get(
  "/posts",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    let { search } = req.query;
    let postsQuery = {};
    let usersQuery = null;

    if (search) {
      postsQuery = {
        $or: [
          { title: { $regex: search, $options: "i" } },
          { content: { $regex: search, $options: "i" } },
        ],
      };
      usersQuery = { username: { $regex: search, $options: "i" } };
    }

    const posts = await Post.find(postsQuery)
      .populate("authorUser", "username")
      .populate("authorBusiness", "name")
      .sort({ createdAt: -1 });
    const foundUsers = usersQuery
      ? await User.find(usersQuery).select("username _id").limit(5)
      : [];

    res.render("posts", {
      link: "posts",
      title: search ? `Search: ${search}` : "Business Community",
      posts,
      foundUsers,
      search,
    });
  })
);

app.get(
  "/businesses",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const businesses = await Business.find({ owner: req.user._id });
    res.render("businesses", {
      title: "Manage Businesses",
      businesses,
      link: "businesses",
    });
  })
);

app.get("/businessAdd", isLoggedIn, (req, res) => {
  res.render("businessAdd", { title: "Register Business", link: "businesses" });
});

app.post(
  "/businesses",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { business } = req.body;
    let newBusiness = new Business(business);
    newBusiness.owner = req.user._id;

    await newBusiness.save();
    let user = await User.findById(req.user._id);
    user.businesses.push(newBusiness);
    await user.save();
    req.flash("success", "Business registered successfully!");
    res.redirect("/businesses");
  })
);

app.delete(
  "/businesses/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    let { id } = req.params;
    // AUTHORIZATION: Only owner can delete
    const business = await Business.findById(id);
    if (!business.owner.equals(req.user._id)) {
      req.flash("error", "You do not have permission to delete this business.");
      return res.redirect("/businesses");
    }

    await User.findByIdAndUpdate(req.user._id, {
      $pull: { businesses: id },
    });
    await Post.deleteMany({ authorBusiness: id });
    await Business.findByIdAndDelete(id);
    req.flash("success", "Business deleted!!");
    res.redirect("/businesses");
  })
);

app.get(
  "/myPosts",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const posts = await Post.find({ authorUser: req.user._id }).sort({
      createdAt: -1,
    });
    res.render("myPosts", { link: "myPosts", title: "My Posts", posts });
  })
);

app.get(
  "/addPost",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const businesses = await Business.find({ owner: req.user._id });
    res.render("addPost", { title: "Add Post", link: "addPost", businesses });
  })
);

app.post(
  "/addPost",
  isLoggedIn,
  upload.array("post[images]"),
  wrapAsync(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      req.flash("error", "No files are added!!");
      return res.redirect("/addPost");
    }
    const urls = [];
    for (let file of req.files) {
      const result = await new Promise((resolve, reject) => {
        cloudinary.uploader
          .upload_stream({ folder: "uploads" }, (error, result) => {
            if (error) reject(error);
            else resolve(result);
          })
          .end(file.buffer);
      });
      urls.push(result.secure_url);
    }
    const { post } = req.body;
    post.upvotes = 0;
    post.downvotes = 0;
    post.images = [...urls];
    post.authorUser = req.user._id;
    let newPost = new Post(post);
    await newPost.save();
    let user = await User.findById(req.user._id);
    user.posts.push(newPost);
    await user.save();
    req.flash("success", "Post added successfully!");
    res.redirect("/myPosts");
  })
);

app.delete(
  "/posts/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    let { id } = req.params;
    // AUTHORIZATION: Only author can delete
    const post = await Post.findById(id);
    if (!post.authorUser.equals(req.user._id)) {
      req.flash("error", "You do not have permission to delete this post.");
      return res.redirect("/myPosts");
    }

    await User.findOneAndUpdate(
      { _id: req.user._id },
      { $pull: { posts: id } }
    );
    await Post.findByIdAndDelete(id);
    req.flash("success", "Post deleted successfully");
    res.redirect("/myPosts");
  })
);

app.patch("/posts/:id/vote", isLoggedIn, async (req, res) => {
  const { action } = req.body;
  const update = {};

  if (action === "addUp") update.$inc = { upvotes: 1 };
  if (action === "removeUp") update.$inc = { upvotes: -1 };
  if (action === "addDown") update.$inc = { downvotes: 1 };
  if (action === "removeDown") update.$inc = { downvotes: -1 };

  const post = await Post.findByIdAndUpdate(req.params.id, update, {
    new: true,
  });
  res.json({ newScore: post.upvotes - post.downvotes });
});

app.get(
  "/connections",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const user = await User.findById(req.user._id)
      .populate("connections", "username image email")
      .populate("pendingRequests", "username image email")
      .populate("sentRequests", "username image email");
    res.render("connections", {
      title: "Manage Network",
      currUser: user,
      link: "connections",
    });
  })
);

app.post(
  "/connect/accept/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const requesterId = req.params.id;
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { pendingRequests: requesterId },
      $addToSet: { connections: requesterId },
    });
    await User.findByIdAndUpdate(requesterId, {
      $pull: { sentRequests: req.user._id },
      $addToSet: { connections: req.user._id },
    });
    req.flash("success", "Connection accepted!");
    res.redirect("/connections");
  })
);

app.post(
  "/connect/decline/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const requesterId = req.params.id;
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { pendingRequests: requesterId },
    });
    await User.findByIdAndUpdate(requesterId, {
      $pull: { sentRequests: req.user._id },
    });
    req.flash("success", "Request declined.");
    res.redirect("/connections");
  })
);

app.post(
  "/connect/remove/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const friendId = req.params.id;
    await User.findByIdAndUpdate(req.user._id, {
      $pull: { connections: friendId },
    });
    await User.findByIdAndUpdate(friendId, {
      $pull: { connections: req.user._id },
    });
    req.flash("success", "Connection removed successfully!");
    res.redirect("/connections");
  })
);

app.get(
  "/connect/add/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const friendId = req.params.id;
    if (friendId === req.user._id.toString()) {
      req.flash("error", "You cannot connect with yourself.");
      return res.redirect("back");
    }
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { sentRequests: friendId },
    });
    await User.findByIdAndUpdate(friendId, {
      $addToSet: { pendingRequests: req.user._id },
    });
    req.flash("success", "Connection request sent!");
    res.redirect(`/profile/${friendId}`);
  })
);

app.get(
  "/analysis/rerun",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { query } = req.query;
    if (!query) return res.redirect("/dashboard");
    res.render("loading", {
      query: query,
      title: "Neural Mapping",
      link: "analysis",
      isRerun: "true",
    });
  })
);

app.post(
  "/reports/:id/delete",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    // AUTHORIZATION: Only author can delete report
    await Report.findOneAndDelete({ _id: id, author: req.user._id });
    req.flash("success", "Report deleted successfully!");
    res.redirect("/dashboard");
  })
);

app.get("/login", (req, res) => {
  res.render("login", { link: "login", title: "Sign In" });
});

app.post(
  "/login",
  saveUrl, 
  passport.authenticate("local", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  (req, res) => {
    req.flash("success", "Welcome back to MarketMapper!");
    const redirectUrl = res.locals.url || "/dashboard"; 
    res.redirect(redirectUrl);
  }
);

app.post(
  "/signup",
  wrapAsync(async (req, res, next) => {
    try {
      const { username, email, password } = req.body;
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        req.flash("error", "An account with this email already exists. Please Sign In.");
        return res.redirect("/login");
      }

      const user = new User({ email, username });
      const registeredUser = await User.register(user, password);

      req.login(registeredUser, (err) => {
        if (err) return next(err);
        
        req.flash("success", "Neural Identity Created. Welcome to MarketMapper!");
        const redirectUrl = req.session.redirectUrl || "/dashboard";
        delete req.session.redirectUrl; 
        res.redirect(redirectUrl);
      });

    } catch (e) {
      req.flash("error", e.message);
      res.redirect("/login"); 
    }
  })
);

app.get(
  "/auth/google",
  passport.authenticate("google", { 
    scope: ["profile", "email"], 
    prompt: "select_account" 
  })
);

app.get(
  "/auth/google/callback",
  saveUrl,
  passport.authenticate("google", {
    failureRedirect: "/login",
    failureFlash: true,
  }),
  (req, res) => {
    req.flash("success", `Welcome, ${req.user.username}!`);
    const redirectUrl = res.locals.url || "/dashboard";
    delete req.session.redirectUrl;
    res.redirect(redirectUrl);
  }
);

app.get("/logout", isLoggedIn, (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    req.flash("success", "Logged out successfully.");
    res.redirect("/");
  });
});

app.get(
  "/history",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const allReports = await Report.find({ author: req.user._id }).sort({
      createdAt: -1,
    });
    res.render("history", {
      title: "Market History",
      reports: allReports,
      link: "history",
    });
  })
);

app.get("/profile/edit", isLoggedIn, (req, res) => {
  res.render("editProfile", {
    title: "Edit Neural Identity",
    link: "profile",
    score: 0,
  });
});

app.get(
  "/profile/:id",
  wrapAsync(async (req, res) => {
    let { id } = req.params;
    let user = await User.findById(id)
      .populate("posts")
      .populate("businesses")
      .populate("sentRequests", "username email image")
      .populate("pendingRequests", "username email image")
      .populate("connections", "username email image reputationScore");

    const reportCount = await Report.countDocuments({ author: id });
    const contractCount = await Agreement.countDocuments({
        $or: [{ sender: id }, { receiver: id }]
    });

    let calculatedScore = 25 + (reportCount * 5) + (contractCount * 10);
    if (calculatedScore > 99) calculatedScore = 99;

    res.render("profile", {
      title: "Neural Profile",
      link: "profile",
      user,
      score: calculatedScore 
    });
  })
);

app.post(
  "/profile/update",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { username } = req.body;
    await User.findByIdAndUpdate(req.user._id, { username });
    req.flash("success", "Profile updated!");
    res.redirect("/profile/" + req.user._id);
  })
);

app.get(
  "/conversations",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { search } = req.query;
    const user = await User.findById(req.user._id).populate({
      path: "connections",
      select: "username image _id",
    });

    let connections = user.connections || [];
    if (search) {
      const searchLower = search.toLowerCase();
      connections = connections.filter((friend) =>
        friend.username.toLowerCase().includes(searchLower)
      );
    }

    res.render("conversations", {
      link: "conversations",
      title: "Conversations",
      connections,
      search: search || "",
    });
  })
);

app.get(
  "/chat/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    let { id } = req.params;
    let conv = await Conversation.findOne({
      participants: { $all: [id, req.user._id], $size: 2 },
    })
      .populate("participants", "username image email")
      .populate("messages");

    let otherUser = await User.findById(id);
    let chats = conv ? conv.messages : [];
    res.render("chat", {
      link: "chat",
      title: "Chat",
      chats,
      otherUser,
      currUser: req.user,
    });
  })
);

app.post(
  "/messages/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const { content } = req.body;
    if (!content || content.trim() === "") return res.redirect("back");

    const message = new Message({
      sender: req.user._id,
      receiver: id,
      content,
    });
    await message.save();

    let conv = await Conversation.findOne({
      participants: { $all: [id, req.user._id], $size: 2 },
    });

    if (!conv) {
      conv = new Conversation({
        participants: [req.user._id, id],
        messages: [],
      });
    }

    conv.messages.push(message._id);
    await conv.save();
    res.redirect("/chat/" + id);
  })
);

app.get(
  "/agreement/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    let { id } = req.params;
    let receiver = await User.findById(id);
    res.render("contracts/new", {
      link: "agreement",
      title: "Agreement",
      receiver,
    });
  })
);

app.get(
  "/contracts",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const allAgreements = await Agreement.find({
      $or: [{ sender: req.user._id }, { receiver: req.user._id }],
    })
      .populate("sender receiver")
      .sort({ createdAt: -1 });

    const received = allAgreements.filter(
      (a) => a.receiver._id.equals(req.user._id) && a.status === "Pending"
    );
    const sent = allAgreements.filter(
      (a) => a.sender._id.equals(req.user._id) && a.status === "Pending"
    );
    const active = allAgreements.filter((a) => a.status === "Active");
    const completed = allAgreements.filter((a) => a.status === "Completed");
    const disputed = allAgreements.filter((a) => a.status === "Disputed");
    res.render("contracts/index", {
      title: "Contract Hub",
      received,
      sent,
      active,
      completed,
      disputed,
      link: "contracts",
    });
  })
);

app.post(
  "/contracts/:receiverId",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { agreement } = req.body;
    const receiverId = req.params.receiverId;

    const newAgreement = new Agreement({
      ...agreement,
      sender: req.user._id,
      receiver: receiverId,
      status: "Pending",
    });

    await newAgreement.save();
    const alertMsg = new Message({
      sender: req.user._id,
      receiver: receiverId,
      content: `PROPOSAL: New Agreement created for "${agreement.title}". Value: ₹${agreement.amount}.`,
    });
    await alertMsg.save();

    req.flash("success", "Contract proposal successfully dispatched!");
    res.redirect(`/chat/${receiverId}`);
  })
);

app.post(
  "/contracts/accept/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    // AUTHORIZATION: Only receiver can accept
    const agreement = await Agreement.findById(id);
    if (!agreement.receiver.equals(req.user._id)) {
      req.flash("error", "Unauthorized action.");
      return res.redirect("/contracts");
    }

    agreement.status = "Active";
    await agreement.save();

    const acceptMsg = new Message({
      sender: req.user._id,
      receiver: agreement.sender,
      content: `✅ AGREEMENT ACCEPTED: "${agreement.title}" is now active.`,
    });
    await acceptMsg.save();

    req.flash("success", "Contract started!");
    res.redirect("/contracts");
  })
);

app.post(
  "/contracts/decline/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const agreement = await Agreement.findById(req.params.id);
    if (!agreement.receiver.equals(req.user._id)) {
      req.flash("error", "Unauthorized action.");
      return res.redirect("/contracts");
    }
    agreement.status = "Declined";
    await agreement.save();
    req.flash("error", "Proposal declined.");
    res.redirect("/contracts");
  })
);

app.post(
  "/contracts/complete/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    await Agreement.findByIdAndUpdate(req.params.id, { status: "Completed" });
    req.flash("success", "Project completed!");
    res.redirect("/contracts");
  })
);

app.post(
  "/contracts/dispute/:id",
  isLoggedIn,
  wrapAsync(async (req, res) => {
    const { id } = req.params;
    const { disputeReason } = req.body;

    const agreement = await Agreement.findByIdAndUpdate(
      id,
      {
        status: "Disputed",
        disputeReason: disputeReason,
        disputedAt: new Date(),
      },
      { new: true }
    );

    const otherParty = agreement.sender.equals(req.user._id)
      ? agreement.receiver
      : agreement.sender;

    const disputeMsg = new Message({
      sender: req.user._id,
      receiver: otherParty,
      content: `⚠️ DISPUTE RAISED: "${agreement.title}". Reason: ${disputeReason}`,
    });
    await disputeMsg.save();

    req.flash("error", "Dispute filed. The contract is now frozen.");
    res.redirect("/contracts");
  })
);

app.get("/about", (req, res) => {
  res.render("about", {
    title: "About Us | Vector Victory",
    link: "about",
  });
});

app.all(/.*/, (req, res) => {
  throw new expressError(404, "Page not found!!");
});

app.use((err, req, res, next) => {
  let { status: st = 500, message = "Something went wrong" } = err;
  res
    .status(st)
    .render("error", { title: "Error", link: "error", code: st, message });
});
