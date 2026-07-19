import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { fallbackProducts, initialCart } from "./data";
import { CartIcon, CheckIcon, CloseIcon, SearchIcon } from "./icons";
import "./styles.css";

const API_URL = import.meta.env.VITE_API_URL || "";

function App() {
  const [products, setProducts] = useState(fallbackProducts);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All categories");
  const [cart, setCart] = useState(initialCart);
  const [cartOpen, setCartOpen] = useState(() => window.innerWidth >= 1240);
  const [checkedOut, setCheckedOut] = useState(false);

  useEffect(() => {
    if (!API_URL) return;
    const controller = new AbortController();
    fetch(`${API_URL}/products`, { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error(`Catalog returned ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (Array.isArray(payload.products)) setProducts(payload.products);
      })
      .catch((error) => {
        if (error.name !== "AbortError") console.warn("Using the bundled catalog fallback.", error);
      });
    return () => controller.abort();
  }, []);

  const filteredProducts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return products.filter((product) => (
      (!needle || product.name.toLowerCase().includes(needle))
      && (category === "All categories" || product.category === category)
    ));
  }, [category, products, query]);

  const cartLines = products.filter((product) => cart[product.id] > 0);
  const itemCount = cartLines.length;
  const subtotal = cartLines.reduce((total, product) => total + product.price * cart[product.id], 0);

  function setQuantity(productId, quantity) {
    setCheckedOut(false);
    setCart((current) => {
      const next = { ...current };
      if (quantity <= 0) delete next[productId];
      else next[productId] = quantity;
      return next;
    });
  }

  function addToCart(productId) {
    setQuantity(productId, (cart[productId] || 0) + 1);
    setCartOpen(true);
  }

  function scrollToProducts() {
    document.querySelector("#products")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className={cartOpen ? "store-shell cart-is-open" : "store-shell"}>
      <div className="store-main">
        <header className="site-header">
          <a className="wordmark" href="#top">Storefront</a>
          <nav aria-label="Storefront navigation">
            {['Shop', 'New', 'Bestsellers', 'Clothing', 'Accessories'].map((item) => <a key={item} href="#products">{item}</a>)}
          </nav>
          <Search value={query} onChange={setQuery} label="Search products from the header" />
          <button className="cart-button" type="button" onClick={() => setCartOpen(true)} aria-label={`Open cart with ${itemCount} products`}>
            <CartIcon /><span>{itemCount}</span>
          </button>
        </header>

        <main id="top">
          <section className="hero">
            <div className="hero-copy">
              <h1>Everyday essentials,<br />shipped fast.</h1>
              <p>Quality products you’ll love, at prices you’ll love.</p>
              <button className="primary" type="button" onClick={scrollToProducts}>Shop all products</button>
            </div>
            <img src="/assets/storefront-hero.jpg" alt="Canvas tote, black cap, and ceramic mug arranged for a catalog photograph" />
          </section>

          <section className="catalog" id="products">
            <div className="catalog-tools">
              <Search value={query} onChange={setQuery} label="Search products" />
              <label className="select-wrap">
                <span className="sr-only">Product category</span>
                <select value={category} onChange={(event) => setCategory(event.target.value)}>
                  <option>All categories</option>
                  <option>Clothing</option>
                  <option>Accessories</option>
                  <option>Home</option>
                </select>
              </label>
            </div>
            <div className="catalog-heading">
              <h2>Featured products</h2>
              <button type="button" onClick={() => { setQuery(""); setCategory("All categories"); }}>View all</button>
            </div>
            <div className="product-grid" aria-live="polite">
              {filteredProducts.map((product) => <ProductCard key={product.id} product={product} onAdd={() => addToCart(product.id)} />)}
              {filteredProducts.length === 0 ? <p className="empty">No products match that search.</p> : null}
            </div>
          </section>
        </main>
      </div>

      <CartDrawer
        open={cartOpen}
        lines={cartLines}
        cart={cart}
        subtotal={subtotal}
        checkedOut={checkedOut}
        onClose={() => setCartOpen(false)}
        onQuantity={setQuantity}
        onCheckout={() => setCheckedOut(true)}
      />
    </div>
  );
}

function Search({ value, onChange, label }) {
  return <label className="search"><span className="sr-only">{label}</span><SearchIcon /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder="Search products…" /></label>;
}

function ProductCard({ product, onAdd }) {
  return (
    <article className="product-card">
      <img src={product.image} alt={product.name} />
      <div className="product-meta"><h3>{product.name}</h3><span>${product.price.toFixed(2)}</span></div>
      <div className="swatches" aria-label={`${product.name} colors`}>{product.colors.map((color, index) => <span key={color} className={index === 0 ? "selected" : ""} style={{ background: color }} />)}</div>
      <button type="button" onClick={onAdd}><CartIcon /> Add to cart</button>
    </article>
  );
}

function CartDrawer({ open, lines, cart, subtotal, checkedOut, onClose, onQuantity, onCheckout }) {
  return (
    <aside className={open ? "cart-drawer open" : "cart-drawer"} aria-hidden={!open} aria-label="Shopping cart">
      <header><h2>Your cart ({lines.length})</h2><button type="button" onClick={onClose} aria-label="Close cart"><CloseIcon /></button></header>
      <div className="cart-lines">
        {lines.map((product) => (
          <article className="cart-line" key={product.id}>
            <img src={product.image} alt="" />
            <div className="cart-line-copy"><h3>{product.name}</h3><p>${product.price.toFixed(2)}</p><div className="quantity"><button type="button" onClick={() => onQuantity(product.id, cart[product.id] - 1)} aria-label={`Decrease ${product.name} quantity`}>−</button><span>{cart[product.id]}</span><button type="button" onClick={() => onQuantity(product.id, cart[product.id] + 1)} aria-label={`Increase ${product.name} quantity`}>+</button></div></div>
            <button className="remove" type="button" onClick={() => onQuantity(product.id, 0)} aria-label={`Remove ${product.name}`}><CloseIcon /></button>
            <strong>${(product.price * cart[product.id]).toFixed(2)}</strong>
          </article>
        ))}
        {lines.length === 0 ? <p className="cart-empty">Your cart is empty.</p> : null}
      </div>
      <footer>
        <div className="subtotal"><span>Subtotal</span><strong>${subtotal.toFixed(2)}</strong></div>
        <button className="checkout" type="button" disabled={lines.length === 0} onClick={onCheckout}>Checkout</button>
        {checkedOut ? <div className="success" role="status"><span><CheckIcon /></span><p><strong>Order placed successfully!</strong><br />Thanks for shopping with us.</p></div> : null}
      </footer>
    </aside>
  );
}

createRoot(document.getElementById("root")).render(<App />);
